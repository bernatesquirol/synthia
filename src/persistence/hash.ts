import type { Snapshot } from "./types";

function canonical(snapshot: Snapshot): string {
  const keys = Object.keys(snapshot).sort();
  return JSON.stringify(keys.map((k) => [k, snapshot[k]]));
}

/** True when SubtleCrypto is available, i.e. we are in a secure context. */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

// SubtleCrypto only exists in secure contexts, so it is undefined when the
// page is served over plain HTTP from a LAN address (localhost is exempt).
// Fail with something actionable rather than a TypeError on `.digest`.
function requireSubtle(): void {
  if (!canHash()) {
    throw new Error(
      "Cannot hash: crypto.subtle is unavailable because this page " +
        "is not a secure context. Use https, or localhost, to publish.",
    );
  }
}

function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSnapshot(
  snapshot: Snapshot,
  length = 12,
): Promise<string> {
  requireSubtle();
  const text = canonical(snapshot);
  const buf = new TextEncoder().encode(text);
  return toHex(await crypto.subtle.digest("SHA-256", buf)).slice(0, length);
}

/**
 * Content hash of raw bytes, for naming an immutable binary object. Longer
 * than a snapshot hash by default because these names are the only thing
 * standing between two different uploads sharing a key.
 */
export async function hashBytes(
  data: ArrayBuffer,
  length = 32,
): Promise<string> {
  requireSubtle();
  return toHex(await crypto.subtle.digest("SHA-256", data)).slice(0, length);
}
