export type Snapshot = Record<string, string>;

export interface VersionMeta {
  hash: string;
  createdAt: number;
  size: number;
  label?: string;
  parentHash?: string;
}

export interface StorageAdapter {
  get(projectId: string, hash: string): Promise<Snapshot | null>;
  put(
    projectId: string,
    hash: string,
    snapshot: Snapshot,
    meta: VersionMeta,
  ): Promise<void>;
  list(projectId: string): Promise<VersionMeta[]>;
  remove?(projectId: string, hash: string): Promise<void>;
  // Read a raw, non-versioned object stored at a fixed name under the project
  // prefix (e.g. "users.json"). Returns its text, or null if absent. Used for
  // out-of-band metadata that must be read WITHOUT loading a snapshot.
  getObject?(projectId: string, name: string): Promise<string | null>;
  // Write a raw, non-versioned object at a fixed name under the project prefix
  // (e.g. "settings.json"). The counterpart to getObject.
  putObject?(projectId: string, name: string, content: string): Promise<void>;
  // Delete a raw, non-versioned object under the project prefix (e.g. a single
  // "conversations/<id>.json" thread). No-op if the adapter doesn't support it.
  removeObject?(projectId: string, name: string): Promise<void>;
}
