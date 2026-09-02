import type { Snapshot } from "./types";

function canonical(snapshot: Snapshot): string {
  const keys = Object.keys(snapshot).sort();
  return JSON.stringify(keys.map((k) => [k, snapshot[k]]));
}

/** True when SubtleCrypto is available, i.e. we are in a secure context. */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

export async function hashSnapshot(
  snapshot: Snapshot,
  length = 12,
): Promise<string> {
  // SubtleCrypto only exists in secure contexts, so this is undefined when the
  // page is served over plain HTTP from a LAN address (localhost is exempt).
  // Fail with something actionable rather than a TypeError on `.digest`.
  if (!canHash()) {
    throw new Error(
      "Cannot hash a snapshot: crypto.subtle is unavailable because this page " +
        "is not a secure context. Use https, or localhost, to publish.",
    );
  }
  const text = canonical(snapshot);
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, length);
}
