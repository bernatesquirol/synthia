import type { Snapshot, StorageAdapter, VersionMeta } from "./types";
import { hashSnapshot } from "./hash";

export class VersionedRepo {
  constructor(
    private adapter: StorageAdapter,
    private projectId: string,
  ) {}

  // The projectId is the storage namespace (S3 key prefix / localStorage scope).
  // It can be switched at runtime so a single app can target different envs
  // (e.g. bots/fishtank-agent-dev vs bots/myproject-prod) without rebuilding the adapter.
  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string {
    return this.projectId;
  }

  async save(
    snapshot: Snapshot,
    opts?: { label?: string; parentHash?: string },
  ): Promise<string> {
    const hash = await hashSnapshot(snapshot);
    const existing = (await this.history()).find((m) => m.hash === hash);
    const meta: VersionMeta = {
      hash,
      createdAt: existing?.createdAt ?? Date.now(),
      size: JSON.stringify(snapshot).length,
      label: opts?.label ?? existing?.label,
      parentHash: opts?.parentHash ?? existing?.parentHash,
    };
    await this.adapter.put(this.projectId, hash, snapshot, meta);
    return hash;
  }

  async load(hash: string): Promise<Snapshot | null> {
    return this.adapter.get(this.projectId, hash);
  }

  async history(): Promise<VersionMeta[]> {
    return this.adapter.list(this.projectId);
  }

  // Read a raw, non-versioned object (e.g. "users.json") under the current
  // project prefix, without loading a snapshot. Null if absent or unsupported.
  async loadObject(name: string): Promise<string | null> {
    return this.adapter.getObject
      ? this.adapter.getObject(this.projectId, name)
      : null;
  }

  // Write a raw, non-versioned object (e.g. "settings.json") under the current
  // project prefix. The counterpart to loadObject.
  async saveObject(name: string, content: string): Promise<void> {
    if (!this.adapter.putObject)
      throw new Error("putObject not supported by this adapter");
    await this.adapter.putObject(this.projectId, name, content);
  }

  // Delete a raw, non-versioned object under the current project prefix.
  async removeObject(name: string): Promise<void> {
    await this.adapter.removeObject?.(this.projectId, name);
  }

  // Read a raw, non-versioned binary object under the current project prefix.
  // Null when absent, or when the adapter has no binary support at all.
  async loadBlob(name: string): Promise<Blob | null> {
    return this.adapter.getBlob
      ? this.adapter.getBlob(this.projectId, name)
      : null;
  }

  // Write a raw, non-versioned binary object under the current project prefix.
  async saveBlob(name: string, blob: Blob): Promise<void> {
    if (!this.adapter.putBlob)
      throw new Error("putBlob not supported by this adapter");
    await this.adapter.putBlob(this.projectId, name, blob);
  }

  async remove(hash: string): Promise<void> {
    await this.adapter.remove?.(this.projectId, hash);
  }
}
