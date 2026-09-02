import { newLine, type PerformanceLine } from "./types";

/**
 * lrclib.net is a free, key-less synced-lyrics database that sends
 * `Access-Control-Allow-Origin: *`, so the browser can query it directly.
 */
const BASE = "https://lrclib.net/api";

export interface LrcTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  /** Track length in seconds, useful for picking the right match. */
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  /** LRC-formatted lyrics with per-line timestamps, when available. */
  syncedLyrics: string | null;
}

export async function searchLyrics(
  trackName: string,
  artistName: string,
): Promise<LrcTrack[]> {
  const params = new URLSearchParams();
  if (trackName) params.set("track_name", trackName);
  if (artistName) params.set("artist_name", artistName);
  if (!trackName && !artistName) return [];

  const res = await fetch(`${BASE}/search?${params}`);
  if (!res.ok) throw new Error(`lrclib search failed (${res.status})`);
  const results = (await res.json()) as LrcTrack[];
  // Synced results are the only ones that can seed timings.
  return results.sort(
    (a, b) => Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics)),
  );
}

/** Matches "[01:23.45]" but not metadata tags like "[ar:Someone]". */
const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Parse LRC text into lines. A source line may carry several timestamps (a
 * repeated chorus), which expands into one entry per timestamp.
 */
export function parseLrc(lrc: string): PerformanceLine[] {
  const out: PerformanceLine[] = [];

  for (const raw of lrc.split(/\r?\n/)) {
    STAMP.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = STAMP.exec(raw)) !== null) {
      times.push(Number(match[1]) * 60 + Number(match[2].replace(":", ".")));
    }
    if (times.length === 0) continue;

    const text = raw.replace(STAMP, "").trim();
    for (const time of times) out.push(newLine(time, text));
  }

  return out.sort((a, b) => a.time - b.time);
}

/** Split unsynced text into lines with no timings yet, ready for tap-sync. */
export function linesFromPlainText(text: string): PerformanceLine[] {
  return text
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => newLine(0, t));
}
