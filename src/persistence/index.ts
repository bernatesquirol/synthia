/**
 * Generic versioned snapshot storage, vendored from another project.
 *
 * This barrel deliberately exports no configured singleton. The upstream
 * version built one whose `projectId` came from `window.location.pathname`,
 * which breaks here: the creator lives at /performance_creator and the viewer
 * at /performance, so they would read and write different key prefixes, and
 * the GitHub Pages base would shift them again. Callers pass an explicit
 * projectId instead — see `src/performance/remote.ts` for this app's wiring.
 */
export type { Snapshot, StorageAdapter, VersionMeta } from "./types";
export { VersionedRepo } from "./repo";
export { LocalStorageAdapter } from "./adapters/localStorage";
export { CompositeAdapter } from "./adapters/composite";
export { S3Adapter, HttpPresignClient } from "./adapters/s3";
export type { PresignOp, PresignClient } from "./adapters/s3";
export { hashSnapshot, hashBytes } from "./hash";
export { readVersionFromUrl, writeVersionToUrl } from "./url";
