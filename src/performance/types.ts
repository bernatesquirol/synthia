/**
 * A performance is the authored document the live screen plays back: a backing
 * video, timed lyric lines, and the chords the player should have available at
 * each moment.
 *
 * Line times are seconds from the start of the video. Chords are *not* stored
 * in seconds: each one sits on a tick (a beat) of the beat grid belonging to
 * its line, and its wall-clock time is derived from the line's start plus the
 * tempo. That keeps chords musically attached to their phrase, so re-timing a
 * line — by tap-syncing it, say — carries its chords along.
 */
export const PERFORMANCE_VERSION = 2;

export interface Tempo {
  bpm: number;
  /** Beats per measure. 4 is 4/4. */
  beatsPerBar: number;
}

export const DEFAULT_TEMPO: Tempo = { bpm: 120, beatsPerBar: 4 };

export interface ChordChange {
  id: string;
  /** Tick index from the start of this line's grid; 0 is the line's downbeat. */
  beat: number;
  /** Pitch class name as used by `PC_NAMES`, e.g. "C", "F#". */
  root: string;
  /** Quality label as used by `QUALITIES`, e.g. "maj", "m7". */
  quality: string;
}

export interface PerformanceLine {
  id: string;
  /** Seconds from the start of the video; the downbeat of this line's grid. */
  time: number;
  text: string;
  /**
   * Measures of beat grid this phrase owns. Default 1; add more when a phrase
   * runs long or when the line stands in for an instrumental gap.
   */
  bars: number;
  chords: ChordChange[];
}

export interface Performance {
  version: number;
  id: string;
  title: string;
  artist: string;
  /** YouTube video id, e.g. "dQw4w9WgXcQ". */
  youtubeId: string;
  /** Video length in seconds, 0 when not yet known. */
  duration: number;
  tempo: Tempo;
  lines: PerformanceLine[];
  createdAt: string;
  updatedAt: string;
}

export function newId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyPerformance(youtubeId = ""): Performance {
  const now = new Date().toISOString();
  return {
    version: PERFORMANCE_VERSION,
    id: newId("perf"),
    title: "",
    artist: "",
    youtubeId,
    duration: 0,
    tempo: { ...DEFAULT_TEMPO },
    lines: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newLine(time: number, text = ""): PerformanceLine {
  return { id: newId("line"), time, text, bars: 1, chords: [] };
}

// ------------------------------------------------------------------ beat grid

export function secondsPerBeat(tempo: Tempo): number {
  return 60 / Math.max(1, tempo.bpm);
}

/** Total ticks in a line's grid. */
export function tickCount(line: PerformanceLine, tempo: Tempo): number {
  return Math.max(1, line.bars) * Math.max(1, tempo.beatsPerBar);
}

/** Wall-clock time of a tick within a line. */
export function tickTime(
  line: PerformanceLine,
  tick: number,
  tempo: Tempo,
): number {
  return line.time + tick * secondsPerBeat(tempo);
}

export function chordTime(
  line: PerformanceLine,
  chord: ChordChange,
  tempo: Tempo,
): number {
  return tickTime(line, chord.beat, tempo);
}

// -------------------------------------------------------------------- queries

/** Lines sorted by time, which the viewer relies on for its cursor. */
export function sortedLines(performance: Performance): PerformanceLine[] {
  return [...performance.lines].sort((a, b) => a.time - b.time);
}

/** Index of the line active at `time`, or -1 before the first line. */
export function lineIndexAt(lines: PerformanceLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export interface TimedChord {
  id: string;
  /** Derived wall-clock time in seconds. */
  time: number;
  root: string;
  quality: string;
  lineId: string;
}

/** Every chord change resolved to seconds and ordered by time. */
export function chordTimeline(performance: Performance): TimedChord[] {
  const out: TimedChord[] = [];
  for (const line of performance.lines) {
    for (const chord of line.chords) {
      out.push({
        id: chord.id,
        time: chordTime(line, chord, performance.tempo),
        root: chord.root,
        quality: chord.quality,
        lineId: line.id,
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The chord sounding at `time`, or null before the first change. */
export function chordAt(
  timeline: TimedChord[],
  time: number,
): TimedChord | null {
  let result: TimedChord | null = null;
  for (const c of timeline) {
    if (c.time > time) break;
    result = c;
  }
  return result;
}

// ------------------------------------------------------------------- time text

/** "1:23.4" for display and editing. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Parse "1:23.4", "83.4" or "1:23" back to seconds; NaN when unparseable. */
export function parseTime(text: string): number {
  const t = text.trim();
  const colon = t.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const plain = Number(t);
  return Number.isFinite(plain) ? plain : NaN;
}

// --------------------------------------------------------------------- parsing

/**
 * Reject anything that is not a plausible performance document, so a bad
 * import fails loudly at the boundary instead of half-rendering later.
 * Version 1 documents stored chord positions in seconds; those are converted
 * to the nearest tick on the way in.
 */
export function parsePerformance(raw: unknown): Performance {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a performance file: expected a JSON object");
  }
  const p = raw as Partial<Performance>;
  if (typeof p.youtubeId !== "string" || !Array.isArray(p.lines)) {
    throw new Error("Not a performance file: missing youtubeId or lines");
  }

  const tempo: Tempo = {
    bpm: positive(p.tempo?.bpm, DEFAULT_TEMPO.bpm),
    beatsPerBar: positive(p.tempo?.beatsPerBar, DEFAULT_TEMPO.beatsPerBar),
  };
  const spb = secondsPerBeat(tempo);

  const lines: PerformanceLine[] = p.lines.map((line, i) => {
    const l = line as Partial<PerformanceLine> & { chords?: unknown[] };
    if (typeof l.text !== "string" || typeof l.time !== "number") {
      throw new Error(`Line ${i + 1} is missing text or time`);
    }
    const bars = Math.max(1, Math.round(positive(l.bars, 1)));

    const chords: ChordChange[] = (l.chords ?? []).map((chord) => {
      const c = chord as Partial<ChordChange> & { time?: number };
      const beat =
        typeof c.beat === "number"
          ? c.beat
          : // v1 fallback: snap the absolute time onto this line's grid.
            Math.max(0, Math.round(((c.time ?? l.time!) - l.time!) / spb));
      return {
        id: c.id ?? newId("chord"),
        beat: Math.max(0, Math.round(beat)),
        root: c.root ?? "C",
        quality: c.quality ?? "maj",
      };
    });

    return {
      id: l.id ?? newId("line"),
      time: l.time,
      text: l.text,
      bars,
      chords,
    };
  });

  const now = new Date().toISOString();
  return {
    version: PERFORMANCE_VERSION,
    id: p.id ?? newId("perf"),
    title: p.title ?? "",
    artist: p.artist ?? "",
    youtubeId: p.youtubeId,
    duration: positive(p.duration, 0),
    tempo,
    lines,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
  };
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
