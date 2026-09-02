import type { Snapshot, StorageAdapter, VersionMeta } from "../types";

const DEFAULT_PREFIX = "vs";

function snapshotKey(prefix: string, projectId: string, hash: string): string {
  return `${prefix}:${projectId}:s:${hash}`;
}
function indexKey(prefix: string, projectId: string): string {
  return `${prefix}:${projectId}:i`;
}
function objectKey(prefix: string, projectId: string, name: string): string {
  return `${prefix}:${projectId}:o:${name}`;
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private prefix: string = DEFAULT_PREFIX) {}

  async get(projectId: string, hash: string): Promise<Snapshot | null> {
    const raw = localStorage.getItem(snapshotKey(this.prefix, projectId, hash));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }

  async put(
    projectId: string,
    hash: string,
    snapshot: Snapshot,
    meta: VersionMeta,
  ): Promise<void> {
    localStorage.setItem(
      snapshotKey(this.prefix, projectId, hash),
      JSON.stringify(snapshot),
    );
    const index = await this.list(projectId);
    const next = [meta, ...index.filter((m) => m.hash !== hash)];
    localStorage.setItem(
      indexKey(this.prefix, projectId),
      JSON.stringify(next),
    );
  }

  async list(projectId: string): Promise<VersionMeta[]> {
    const raw = localStorage.getItem(indexKey(this.prefix, projectId));
    if (!raw) return [];
    try {
      return JSON.parse(raw) as VersionMeta[];
    } catch {
      return [];
    }
  }

  async remove(projectId: string, hash: string): Promise<void> {
    localStorage.removeItem(snapshotKey(this.prefix, projectId, hash));
    const index = await this.list(projectId);
    localStorage.setItem(
      indexKey(this.prefix, projectId),
      JSON.stringify(index.filter((m) => m.hash !== hash)),
    );
  }

  async getObject(projectId: string, name: string): Promise<string | null> {
    return localStorage.getItem(objectKey(this.prefix, projectId, name));
  }

  async putObject(
    projectId: string,
    name: string,
    content: string,
  ): Promise<void> {
    localStorage.setItem(objectKey(this.prefix, projectId, name), content);
  }

  async removeObject(projectId: string, name: string): Promise<void> {
    localStorage.removeItem(objectKey(this.prefix, projectId, name));
  }
}
