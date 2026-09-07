import type { AppConfig } from "../config";
import {
  HttpPresignClient,
  LocalStorageAdapter,
  S3Adapter,
  VersionedRepo,
  type StorageAdapter,
  type VersionMeta,
} from "../persistence";
import { parsePerformance, type Performance } from "./types";

/**
 * Remote storage for performances, laid out under one prefix:
 *
 *   performances/catalogue.json           listing: id, title, artist, updatedAt
 *   performances/<perfId>/index.json      VersionMeta[] for that performance
 *   performances/<perfId>/snapshots/<hash>.json
 *
 * Each performance is its own versioned project, so editing one never rewrites
 * another and every song keeps an independent history you can revert to. The
 * catalogue exists because the adapter can list *versions within a project*
 * but has no way to enumerate projects — without it, nothing could discover
 * what has been published.
 */
const CATALOGUE = "catalogue.json";
const SNAPSHOT_FILE = "performance.json";

export interface CatalogueEntry {
  id: string;
  title: string;
  artist: string;
  /** ISO timestamp of the last publish. */
  updatedAt: string;
  /** Hash of the most recently published version. */
  hash: string;
}

/**
 * Turn an opaque cross-origin failure into something actionable.
 *
 * When a presigned response carries no Access-Control-Allow-Origin, the
 * browser rejects the fetch with a bare "Failed to fetch" TypeError — and the
 * devtools network row shows the underlying status, which is often a perfectly
 * normal 404 for an index.json that does not exist yet. That combination sends
 * you chasing the wrong thing, so name the likely cause.
 */
function explain(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      "The browser could not read the storage response. This is almost " +
        "always a missing CORS rule on the bucket: presigned URLs work from " +
        "curl, but a browser needs Access-Control-Allow-Origin on the " +
        `response to read it. (underlying: ${err.message})`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

export class RemoteStore {
  private adapter: StorageAdapter;
  /** Repo pointed at the collection root, used only for the catalogue. */
  private root: VersionedRepo;

  readonly enabled: boolean;

  constructor(private config: AppConfig) {
    const endpoint = config.persistence.presignEndpoint;
    this.enabled = Boolean(endpoint);

    // Without an endpoint everything still works, just against localStorage,
    // so callers do not need to branch on availability.
    this.adapter = this.enabled
      ? new S3Adapter({
          presigner: new HttpPresignClient({
            endpoint,
            timeoutMs: config.persistence.timeoutMs,
          }),
        })
      : new LocalStorageAdapter("remote-sim");

    this.root = new VersionedRepo(this.adapter, config.persistence.prefix);
  }

  /** Key prefix for one performance, e.g. "performances/perf_a1b2c3". */
  private projectFor(id: string): string {
    return `${this.config.persistence.prefix}/${id}`;
  }

  private repoFor(id: string): VersionedRepo {
    return new VersionedRepo(this.adapter, this.projectFor(id));
  }

  // ------------------------------------------------------------- catalogue

  async listCatalogue(): Promise<CatalogueEntry[]> {
    let raw: string | null;
    try {
      raw = await this.root.loadObject(CATALOGUE);
    } catch (err) {
      throw explain(err);
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as CatalogueEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn("[remote] catalogue is not readable", err);
      return [];
    }
  }

  private async writeCatalogue(entries: CatalogueEntry[]): Promise<void> {
    const sorted = [...entries].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
    await this.root.saveObject(CATALOGUE, JSON.stringify(sorted, null, 2));
  }

  // --------------------------------------------------------------- publish

  /**
   * Write a new immutable version and point the catalogue at it. Returns the
   * content hash, which is stable: republishing unchanged work is a no-op as
   * far as stored snapshots go.
   */
  async publish(performance: Performance): Promise<string> {
    const doc: Performance = {
      ...performance,
      updatedAt: new Date().toISOString(),
    };

    try {
      const hash = await this.repoFor(doc.id).save(
        { [SNAPSHOT_FILE]: JSON.stringify(doc) },
        { label: doc.title || doc.id },
      );

      const entry: CatalogueEntry = {
        id: doc.id,
        title: doc.title,
        artist: doc.artist,
        updatedAt: doc.updatedAt,
        hash,
      };
      const others = (await this.listCatalogue()).filter(
        (e) => e.id !== doc.id,
      );
      await this.writeCatalogue([entry, ...others]);

      return hash;
    } catch (err) {
      throw explain(err);
    }
  }

  // ------------------------------------------------------------------ read

  /** Load a published performance; omit `hash` for the catalogued latest. */
  async fetch(id: string, hash?: string): Promise<Performance | null> {
    let wanted = hash;
    if (!wanted) {
      const entry = (await this.listCatalogue()).find((e) => e.id === id);
      // Fall back to the newest entry in the performance's own index, which
      // covers a publish whose catalogue write did not land.
      wanted = entry?.hash ?? (await this.versions(id))[0]?.hash;
    }
    if (!wanted) return null;

    let snapshot;
    try {
      snapshot = await this.repoFor(id).load(wanted);
    } catch (err) {
      throw explain(err);
    }
    const raw = snapshot?.[SNAPSHOT_FILE];
    if (!raw) return null;
    return parsePerformance(JSON.parse(raw));
  }

  /** Version history for one performance, newest first. */
  async versions(id: string): Promise<VersionMeta[]> {
    return this.repoFor(id).history();
  }

  /**
   * Drop a performance from the catalogue. The snapshots stay: they are
   * immutable and content-addressed, so any `?v=` link keeps resolving.
   */
  async unpublish(id: string): Promise<void> {
    const remaining = (await this.listCatalogue()).filter((e) => e.id !== id);
    await this.writeCatalogue(remaining);
  }
}
