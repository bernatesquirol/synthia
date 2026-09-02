import { LocalStorageAdapter } from "./adapters/localStorage";
import { HttpPresignClient, S3Adapter } from "./adapters/s3";
import { VersionedRepo } from "./repo";
import type { StorageAdapter } from "./types";

export type { Snapshot, StorageAdapter, VersionMeta } from "./types";
export { VersionedRepo } from "./repo";
export { LocalStorageAdapter } from "./adapters/localStorage";
export { CompositeAdapter } from "./adapters/composite";
export { S3Adapter, HttpPresignClient } from "./adapters/s3";
export type { PresignOp, PresignClient } from "./adapters/s3";
export { hashSnapshot } from "./hash";
export { readVersionFromUrl, writeVersionToUrl } from "./url";

declare global {
  interface Window {
    RUNTIME_CONFIG?: {
      PERSISTENCE_PRESIGN_ENDPOINT?: string;
      PERSISTENCE_PRESIGN_TOKEN?: string;
      PERSISTENCE_PROJECT_ID?: string;
    };
  }
}

function sanitisePathAsProjectId(path: string): string {
  return path.replace(/^\/+|\/+$/g, "") || "default";
}

function resolveProjectId(): string {
  if (typeof window === "undefined") return "default";
  const override = window.RUNTIME_CONFIG?.PERSISTENCE_PROJECT_ID;
  if (override) return override;
  return sanitisePathAsProjectId(window.location.pathname);
}

function buildDefaultAdapter(): StorageAdapter {
  const endpoint = window.RUNTIME_CONFIG?.PERSISTENCE_PRESIGN_ENDPOINT;
  // No S3 configured (e.g. local dev without creds): fall back to localStorage so
  // the app still works standalone.
  if (!endpoint) return new LocalStorageAdapter();

  // S3 is the single source of truth. We deliberately do NOT wrap it in a
  // localStorage cache (CompositeAdapter): a per-browser cache is read local-first,
  // so different people end up seeing different versions of the same shared brain.
  // Every read/write goes straight to S3 instead.
  const token = window.RUNTIME_CONFIG?.PERSISTENCE_PRESIGN_TOKEN;
  const presigner = new HttpPresignClient({
    endpoint,
    headers: token ? () => ({ Authorization: `Bearer ${token}` }) : undefined,
  });
  return new S3Adapter({ presigner });
}

// Default singleton — convenient for the common case. Apps that want a custom
// adapter (e.g. S3-only, different auth, alternate prefix) can ignore this and
// `new VersionedRepo(...)`.
export const repo = new VersionedRepo(
  buildDefaultAdapter(),
  resolveProjectId(),
);

// A fresh VersionedRepo over the same default adapter, pointed at an explicit
// projectId. Used when a store needs a SECOND, independent snapshot target
// alongside the `repo` singleton (e.g. the shared root-brain content layer) so
// the two never fight over one mutable projectId.
export const makeRepo = (projectId: string): VersionedRepo =>
  new VersionedRepo(buildDefaultAdapter(), projectId);
