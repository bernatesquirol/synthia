import type { Snapshot, StorageAdapter, VersionMeta } from "../types";

export type PresignOp = "get" | "put" | "delete";

export interface PresignClient {
  presign(op: PresignOp, key: string): Promise<string>;
}

export interface HttpPresignClientOptions {
  endpoint: string;
  headers?: () => Record<string, string>;
  timeoutMs?: number;
}

// Talks to a server (e.g. Lambda) that returns short-lived pre-signed S3 URLs.
//
// Expected server contract:
//   GET  <endpoint>?op=<get|put|delete>&key=<encoded-key>
//   [Authorization: Bearer <token>]
//   200: { "url": "<https-url>" }
//
// The server is responsible for validating the key prefix, scoping operations,
// and signing the S3 URL.
export class HttpPresignClient implements PresignClient {
  constructor(private opts: HttpPresignClientOptions) {}

  async presign(op: PresignOp, key: string): Promise<string> {
    const controller = new AbortController();
    const t = window.setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? 10_000,
    );
    try {
      const url = new URL(this.opts.endpoint);
      url.searchParams.set("op", op);
      url.searchParams.set("key", key);
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { ...(this.opts.headers?.() ?? {}) },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Presign ${op} ${key} → ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('Presign response missing "url"');
      return data.url;
    } finally {
      window.clearTimeout(t);
    }
  }
}

export interface S3AdapterOptions {
  presigner: PresignClient;
  // Optional override for the base key prefix. Defaults to projectId verbatim.
  // Useful if you want to mount multiple frontends in one bucket subtree.
  keyPrefix?: (projectId: string) => string;
}

// Object layout in the bucket:
//   <prefix>/snapshots/<hash>.json   ← one file per version, content-addressed, immutable
//   <prefix>/index.json              ← the mutable pointer: VersionMeta[], newest-first
//
// The index lets any origin discover the version history (and thus the latest
// snapshot). Without it, `list()` returns [] and a fresh origin — e.g. the
// deployed site vs. localhost, which have separate localStorage — can't find the
// latest snapshot and boots empty. It's a read-modify-write on a single object,
// which is fine for this single-maintainer wiki; concurrent writers from two
// tabs could clobber each other's most recent index entry (the snapshots
// themselves are never lost — they're content-addressed and immutable).
export class S3Adapter implements StorageAdapter {
  constructor(private opts: S3AdapterOptions) {}

  private prefix(projectId: string): string {
    return this.opts.keyPrefix ? this.opts.keyPrefix(projectId) : projectId;
  }

  private snapshotKey(projectId: string, hash: string): string {
    return `${this.prefix(projectId)}/snapshots/${hash}.json`;
  }

  private indexKey(projectId: string): string {
    return `${this.prefix(projectId)}/index.json`;
  }

  private objectKey(projectId: string, name: string): string {
    return `${this.prefix(projectId)}/${name}`;
  }

  private async writeIndex(
    projectId: string,
    index: VersionMeta[],
  ): Promise<void> {
    const url = await this.opts.presigner.presign(
      "put",
      this.indexKey(projectId),
    );
    const res = await fetch(url, {
      method: "PUT",
      body: JSON.stringify(index),
    });
    if (!res.ok) throw new Error(`S3 PUT index → ${res.status}`);
  }

  async get(projectId: string, hash: string): Promise<Snapshot | null> {
    const url = await this.opts.presigner.presign(
      "get",
      this.snapshotKey(projectId, hash),
    );
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`S3 GET snapshot ${hash} → ${res.status}`);
    return (await res.json()) as Snapshot;
  }

  async put(
    projectId: string,
    hash: string,
    snapshot: Snapshot,
    meta: VersionMeta,
  ): Promise<void> {
    const url = await this.opts.presigner.presign(
      "put",
      this.snapshotKey(projectId, hash),
    );
    const res = await fetch(url, {
      method: "PUT",
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) throw new Error(`S3 PUT snapshot ${hash} → ${res.status}`);
    // Record this version in the index (newest-first) so other origins can find it.
    const index = await this.list(projectId);
    await this.writeIndex(projectId, [
      meta,
      ...index.filter((m) => m.hash !== hash),
    ]);
  }

  async list(projectId: string): Promise<VersionMeta[]> {
    const url = await this.opts.presigner.presign(
      "get",
      this.indexKey(projectId),
    );
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return [];
    if (!res.ok) throw new Error(`S3 GET index → ${res.status}`);
    try {
      return (await res.json()) as VersionMeta[];
    } catch {
      return [];
    }
  }

  async getObject(projectId: string, name: string): Promise<string | null> {
    const url = await this.opts.presigner.presign(
      "get",
      this.objectKey(projectId, name),
    );
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`S3 GET object ${name} → ${res.status}`);
    return await res.text();
  }

  async putObject(
    projectId: string,
    name: string,
    content: string,
  ): Promise<void> {
    const url = await this.opts.presigner.presign(
      "put",
      this.objectKey(projectId, name),
    );
    const res = await fetch(url, { method: "PUT", body: content });
    if (!res.ok) throw new Error(`S3 PUT object ${name} → ${res.status}`);
  }

  async getBlob(projectId: string, name: string): Promise<Blob | null> {
    const url = await this.opts.presigner.presign(
      "get",
      this.objectKey(projectId, name),
    );
    const res = await fetch(url);
    if (res.status === 404 || res.status === 403) return null;
    if (!res.ok) throw new Error(`S3 GET object ${name} → ${res.status}`);
    return await res.blob();
  }

  async putBlob(projectId: string, name: string, blob: Blob): Promise<void> {
    const url = await this.opts.presigner.presign(
      "put",
      this.objectKey(projectId, name),
    );
    // No explicit Content-Type header. The browser derives one from the blob,
    // and the presign endpoint does not sign that header — sending one it had
    // signed differently would be rejected with a 403.
    const res = await fetch(url, { method: "PUT", body: blob });
    if (!res.ok) throw new Error(`S3 PUT object ${name} → ${res.status}`);
  }

  async removeObject(projectId: string, name: string): Promise<void> {
    const url = await this.opts.presigner.presign(
      "delete",
      this.objectKey(projectId, name),
    );
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404)
      throw new Error(`S3 DELETE object ${name} → ${res.status}`);
  }

  async remove(projectId: string, hash: string): Promise<void> {
    const url = await this.opts.presigner.presign(
      "delete",
      this.snapshotKey(projectId, hash),
    );
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE snapshot ${hash} → ${res.status}`);
    }
    const index = await this.list(projectId);
    await this.writeIndex(
      projectId,
      index.filter((m) => m.hash !== hash),
    );
  }
}
