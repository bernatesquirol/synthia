import type { Snapshot } from "./types";

function canonical(snapshot: Snapshot): string {
  const keys = Object.keys(snapshot).sort();
  return JSON.stringify(keys.map((k) => [k, snapshot[k]]));
}

export async function hashSnapshot(
  snapshot: Snapshot,
  length = 12,
): Promise<string> {
  const text = canonical(snapshot);
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, length);
}
