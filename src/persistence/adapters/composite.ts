import type { Snapshot, StorageAdapter, VersionMeta } from "../types";

// Local-first cache + authoritative remote. Reads check local; on miss, pull
// from remote and warm the local cache with the actual remote meta. Writes go
// to local synchronously, then to remote in the background — a remote failure
// doesn't block the save, but is reported via console.
//
// list() merges both indexes; remote entries win on hash collision (remote is
// authoritative for createdAt and label). Local-only entries are surfaced too,
// so a snapshot that hasn't synced yet still appears in history.
export class CompositeAdapter implements StorageAdapter {
  constructor(
    private local: StorageAdapter,
    private remote: StorageAdapter,
  ) {}

  async get(projectId: string, hash: string): Promise<Snapshot | null> {
    const fromLocal = await this.local.get(projectId, hash).catch(() => null);
    if (fromLocal) return fromLocal;

    const fromRemote = await this.remote.get(projectId, hash).catch((e) => {
      console.warn("Composite: remote get failed", e);
      return null;
    });
    if (!fromRemote) return null;

    const remoteIndex = await this.remote.list(projectId).catch(() => []);
    const meta: VersionMeta = remoteIndex.find((m) => m.hash === hash) ?? {
      hash,
      createdAt: Date.now(),
      size: JSON.stringify(fromRemote).length,
    };
    this.local.put(projectId, hash, fromRemote, meta).catch((e) => {
      console.warn("Composite: cache warm failed", e);
    });
    return fromRemote;
  }

  async put(
    projectId: string,
    hash: string,
    snapshot: Snapshot,
    meta: VersionMeta,
  ): Promise<void> {
    await this.local.put(projectId, hash, snapshot, meta);
    this.remote.put(projectId, hash, snapshot, meta).catch((e) => {
      console.error("Composite: remote put failed", e);
    });
  }

  async list(projectId: string): Promise<VersionMeta[]> {
    const [local, remote] = await Promise.all([
      this.local.list(projectId).catch(() => []),
      this.remote.list(projectId).catch(() => []),
    ]);
    const byHash = new Map<string, VersionMeta>();
    for (const m of local) byHash.set(m.hash, m);
    for (const m of remote) byHash.set(m.hash, m);
    return Array.from(byHash.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }

  async remove(projectId: string, hash: string): Promise<void> {
    await Promise.all([
      this.local.remove?.(projectId, hash) ?? Promise.resolve(),
      this.remote.remove?.(projectId, hash).catch((e) => {
        console.error("Composite: remote remove failed", e);
      }) ?? Promise.resolve(),
    ]);
  }

  // Auth/metadata must reflect the authoritative remote, so try remote first and
  // only fall back to local (e.g. offline) — never the other way round.
  async getObject(projectId: string, name: string): Promise<string | null> {
    const fromRemote = await this.remote
      .getObject?.(projectId, name)
      .catch((e) => {
        console.warn("Composite: remote getObject failed", e);
        return null;
      });
    if (fromRemote != null) return fromRemote;
    return (await this.local.getObject?.(projectId, name)) ?? null;
  }

  // Remote is authoritative for metadata, so write it there first (and surface a
  // failure), then mirror locally.
  async putObject(
    projectId: string,
    name: string,
    content: string,
  ): Promise<void> {
    await (this.remote.putObject?.(projectId, name, content) ??
      Promise.resolve());
    await (this.local.putObject?.(projectId, name, content) ??
      Promise.resolve());
  }

  async removeObject(projectId: string, name: string): Promise<void> {
    await (this.remote.removeObject?.(projectId, name).catch((e) => {
      console.error("Composite: remote removeObject failed", e);
    }) ?? Promise.resolve());
    await (this.local.removeObject?.(projectId, name) ?? Promise.resolve());
  }
}
