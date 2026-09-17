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
 *
 * An optional backing track plays alongside the video on the same clock, so
 * its timings need no separate representation: it is one audio file covering
 * the whole video, pinned to the video's time by a single offset.
 *
 * The finished piece is not the video. It is the backing track heard over a
 * sequence of photos, with the rewritten lyric of the moment across them; the
 * YouTube video is source material — where the original lyric and its timings
 * come from — and is not shown at performance time. Photos are placed on a
 * *continuous* beat grid that runs the length of the piece, unlike chords,
 * which stay pinned to the phrase they belong to.
 */
export const PERFORMANCE_VERSION = 5;

export interface Tempo {
  bpm: number;
  /** Beats per measure. 4 is 4/4. */
  beatsPerBar: number;
  /**
   * Seconds on the timeline where beat 0 sits. The continuous grid hangs off
   * this, so putting it on the song's first downbeat is what makes every
   * later beat land in the right place.
   */
  anchor: number;
}

export const DEFAULT_TEMPO: Tempo = { bpm: 120, beatsPerBar: 4, anchor: 0 };

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
  /**
   * The original lyric, as imported. Reference material: it is what the
   * source sings at this moment, and it is never shown in the finished
   * piece. Left untouched so you always have something to write against.
   */
  text: string;
  /**
   * The rewritten lyric, which is what the finished piece shows. Empty means
   * nothing has been rewritten here yet, and the original stands in — so a
   * performance is watchable before a single line has been reworked.
   */
  display: string;
  /**
   * Bars this line's row of the score lasts, or 0 to take it from where the
   * next line falls. Hand-timed lyrics land a little off the beat, so the
   * derived length is occasionally a bar out; an explicit value is how that
   * row gets corrected without moving the line itself.
   */
  span: number;
  chords: ChordChange[];
}

/** What the finished piece puts on screen for a line. */
export function displayText(line: PerformanceLine): string {
  return line.display.trim() || line.text;
}

/**
 * An audio file uploaded alongside the performance and played over the video
 * — an instrumental, a stem mix, a re-recording. It runs the full length of
 * the video rather than being cut into cues, so keeping it in sync is a
 * matter of one constant offset plus drift correction at playback time.
 */
export interface BackingTrack {
  /**
   * Object name under the performance's own storage prefix, e.g.
   * "audio/9f3c….mp3". Content-addressed, so replacing a track never
   * invalidates the audio an older published version still points at.
   */
  key: string;
  /** The uploaded file's name, shown in the creator. */
  filename: string;
  /** MIME type the browser reported for the file, e.g. "audio/mpeg". */
  mimeType: string;
  bytes: number;
  /** Decoded length in seconds, compared against the video's own duration. */
  duration: number;
  /**
   * Seconds the track plays *later* than the video: trackTime = videoTime -
   * offset. Positive nudges the track back, for a file that starts with less
   * lead-in than the video does.
   */
  offset: number;
  /** Playback level, 0..1. */
  gain: number;
  /**
   * Whether the source video is muted while the track plays in step 1. A
   * monitoring choice only — the finished piece has no video in it — but an
   * important one: turning it off plays both at once, which is how the
   * offset above gets lined up by ear.
   */
  muteVideo: boolean;
}

/**
 * A photo shown for a stretch of the piece. Position and length are in beats
 * rather than seconds so that changing the tempo re-times the whole slideshow
 * with the music instead of leaving it behind.
 */
/**
 * How a photo meets the frame, which is 16:9 while photos are any shape.
 *
 * "fit" shows the whole picture and lets the frame show through beside it;
 * "crop" fills the frame and loses the edges. Fitting is the default because
 * it cannot silently throw away part of a photo you chose — a crop is worth
 * asking for, never worth assuming.
 */
export type ImageFit = "fit" | "crop";

export const DEFAULT_IMAGE_FIT: ImageFit = "fit";

export interface TimelineImage {
  id: string;
  /** Object name under the performance's prefix, e.g. "images/9f3c….jpg". */
  key: string;
  filename: string;
  mimeType: string;
  bytes: number;
  /** Natural pixel size, so the preview can letterbox correctly. */
  width: number;
  height: number;
  /** First beat of the continuous grid this photo covers. */
  beat: number;
  /** How many beats it stays on screen. At least 1. */
  beats: number;
  /** Whole picture letterboxed, or the frame filled and the edges lost. */
  fit: ImageFit;
}

export const MAX_BACKING_BYTES = 60 * 1024 * 1024;

/** How far the track's length may differ from the video's before we say so. */
export const BACKING_LENGTH_TOLERANCE = 1.5;

export function newBackingTrack(
  fields: Pick<
    BackingTrack,
    "key" | "filename" | "mimeType" | "bytes" | "duration"
  >,
): BackingTrack {
  return { ...fields, offset: 0, gain: 1, muteVideo: true };
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
  /** Audio played over the video, or null when the video carries the sound. */
  backingTrack: BackingTrack | null;
  /** Photos on the continuous beat grid; the finished piece's picture. */
  images: TimelineImage[];
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
    backingTrack: null,
    images: [],
    lines: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newLine(time: number, text = ""): PerformanceLine {
  return { id: newId("line"), time, text, display: "", span: 0, chords: [] };
}

// ------------------------------------------------------------------ beat grid

export function secondsPerBeat(tempo: Tempo): number {
  return 60 / Math.max(1, tempo.bpm);
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

// ------------------------------------------------------- continuous grid

/**
 * The grid photos sit on: one unbroken run of beats from `tempo.anchor` to
 * the end of the piece. Chords keep their own per-line grids, because a
 * chord belongs to its phrase and should follow it when the phrase moves;
 * a photo belongs to the clock and should not.
 */
export function beatTime(tempo: Tempo, beat: number): number {
  return tempo.anchor + beat * secondsPerBeat(tempo);
}

/** Fractional beat at a moment. Negative before the anchor. */
export function beatAt(tempo: Tempo, time: number): number {
  return (time - tempo.anchor) / secondsPerBeat(tempo);
}

/**
 * Beats needed to cover a piece of this length.
 *
 * Floored at sixteen bars so that a performance whose length nobody has
 * measured yet — the video never played, no backing track — still gets a
 * grid you can lay photos on, instead of a single bar.
 */
export function gridLength(tempo: Tempo, duration: number): number {
  const perBar = Math.max(1, tempo.beatsPerBar);
  const beats = Math.ceil(beatAt(tempo, Math.max(0, duration))) + 1;
  // Rounded up to a whole bar, so the grid never ends part way through one.
  return Math.ceil(Math.max(16 * perBar, beats) / perBar) * perBar;
}

/**
 * The photo on screen at `beat`, or null for a gap.
 *
 * Overlaps are allowed rather than prevented — stopping them would make
 * dragging fight the user — and resolved by letting the latest start win, so
 * dropping a photo over another simply takes over from where it lands.
 */
export function imageAt(
  images: TimelineImage[],
  beat: number,
): TimelineImage | null {
  let best: TimelineImage | null = null;
  for (const image of images) {
    if (beat < image.beat || beat >= image.beat + image.beats) continue;
    if (!best || image.beat > best.beat) best = image;
  }
  return best;
}

/**
 * One row of the score: a lyric line and the run of beats it owns.
 *
 * The grid underneath is still continuous — photos carry absolute beat
 * positions and can run straight through several phrases — but it is *shown*
 * wrapped, one phrase per row, the way a stave wraps into systems. A phrase
 * runs from its own downbeat to the next line's, so the rows partition the
 * grid with no gaps to lose a photo in.
 *
 * Every row is a whole number of bars. Timings taken off a recording are never
 * that tidy, so the row a line is *shown* on is snapped to the nearest bar
 * while the line keeps the time it was recorded at.
 */
export interface Phrase {
  id: string;
  /** The line this row carries, or null for a run with no lyric on it. */
  line: PerformanceLine | null;
  /** Shown in place of a lyric on the runs that have none. */
  label: string;
  startBeat: number;
  /** One past the last beat this phrase owns. */
  endBeat: number;
  /** Length in whole bars, which is what the row's control shows. */
  bars: number;
  /**
   * Longest this row could be made before it would reach into the next line.
   * The row after a shortened one is a rest, so growing back is always
   * possible up to this; past it there is another lyric in the way.
   */
  maxBars: number;
}

/** A row with no lyric on it: the intro, a rest, the outro. */
function filler(
  id: string,
  label: string,
  startBeat: number,
  endBeat: number,
  perBar: number,
): Phrase {
  const bars = Math.max(1, Math.round((endBeat - startBeat) / perBar));
  return { id, line: null, label, startBeat, endBeat, bars, maxBars: bars };
}

export function phrases(performance: Performance, duration: number): Phrase[] {
  const { tempo } = performance;
  const total = gridLength(tempo, duration);
  const lines = sortedLines(performance);
  const perBar = Math.max(1, tempo.beatsPerBar);
  if (lines.length === 0) {
    return [filler("whole", "no lyrics yet", 0, total, perBar)];
  }

  const starts: number[] = [];
  for (const line of lines) {
    const bar = Math.max(0, Math.round(beatAt(tempo, line.time) / perBar));
    // Two lines sung within the same bar would otherwise share a downbeat and
    // leave one row empty, so each is pushed on to the bar after the last.
    const previous = starts.length > 0 ? starts[starts.length - 1] : -perBar;
    starts.push(Math.max(bar * perBar, previous + perBar));
  }
  const rows: Phrase[] = [];
  if (starts[0] > 0) {
    rows.push(filler("intro", "intro", 0, starts[0], perBar));
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const startBeat = starts[i];
    // Where the next lyric begins, which is as far as this row may ever
    // reach. The last line has only the end of the piece in its way.
    const ceiling =
      i + 1 < lines.length
        ? starts[i + 1]
        : Math.max(total, startBeat + perBar);
    const maxBars = Math.max(1, Math.round((ceiling - startBeat) / perBar));

    let bars: number;
    if (line.span > 0) {
      bars = Math.min(Math.round(line.span), maxBars);
    } else if (i + 1 < lines.length) {
      bars = maxBars;
    } else {
      // Nothing follows the last line to say how long it lasts, so give it
      // the shape of the row before it and let an outro take the rest.
      // Running it to the end of the piece instead would leave one row
      // hundreds of bars wide.
      const previous = i > 0 ? rows[rows.length - 1].bars : 1;
      bars = Math.min(Math.max(1, previous), maxBars);
    }

    const endBeat = startBeat + bars * perBar;
    rows.push({
      id: line.id,
      line,
      label: "",
      startBeat,
      endBeat,
      bars,
      maxBars,
    });

    // A row shortened by hand leaves the beats between it and the next lyric
    // unclaimed. They become a rest rather than a hole: photos carry absolute
    // beats, and a beat no row covers is a photo you can no longer see.
    if (i + 1 < lines.length && endBeat < starts[i + 1]) {
      rows.push(
        filler(`rest-${line.id}`, "rest", endBeat, starts[i + 1], perBar),
      );
    }
  }

  const last = rows[rows.length - 1];
  if (total > last.endBeat) {
    rows.push(filler("outro", "outro", last.endBeat, total, perBar));
  }
  return rows;
}

/** Images in playing order, which is how the timeline draws them. */
export function sortedImages(images: TimelineImage[]): TimelineImage[] {
  return [...images].sort((a, b) => a.beat - b.beat);
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
 * to the nearest tick on the way in. Versions before 3 have no backing track,
 * which reads as null.
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
    anchor: positive(p.tempo?.anchor, DEFAULT_TEMPO.anchor),
  };
  const spb = secondsPerBeat(tempo);

  const lines: PerformanceLine[] = p.lines.map((line, i) => {
    const l = line as Partial<PerformanceLine> & { chords?: unknown[] };
    if (typeof l.text !== "string" || typeof l.time !== "number") {
      throw new Error(`Line ${i + 1} is missing text or time`);
    }
    const span = Math.max(0, Math.round(positive(l.span, 0)));

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
      // Absent before version 4, when every line was its own display text.
      display: typeof l.display === "string" ? l.display : "",
      span,
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
    backingTrack: parseBackingTrack(p.backingTrack),
    images: parseImages(p.images),
    lines,
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
  };
}

/**
 * A track whose `key` is missing is dropped rather than rejected: the audio it
 * named is unreachable either way, and losing the reference is a better
 * outcome than refusing to open the whole performance.
 */
function parseBackingTrack(raw: unknown): BackingTrack | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Partial<BackingTrack>;
  if (typeof t.key !== "string" || !t.key) return null;
  return {
    key: t.key,
    filename: t.filename ?? t.key,
    mimeType: t.mimeType ?? "audio/mpeg",
    bytes: positive(t.bytes, 0),
    duration: positive(t.duration, 0),
    // The offset is the one field that is legitimately negative.
    offset:
      typeof t.offset === "number" && Number.isFinite(t.offset) ? t.offset : 0,
    gain: Math.min(1, positive(t.gain, 1)),
    muteVideo: t.muteVideo !== false,
  };
}

/**
 * Photos with no key name nothing reachable, so they are dropped rather than
 * rejected: the same bargain `parseBackingTrack` makes.
 */
function parseImages(raw: unknown): TimelineImage[] {
  if (!Array.isArray(raw)) return [];
  const out: TimelineImage[] = [];
  for (const entry of raw) {
    const i = entry as Partial<TimelineImage>;
    if (typeof i.key !== "string" || !i.key) continue;
    out.push({
      id: i.id ?? newId("img"),
      key: i.key,
      filename: i.filename ?? i.key,
      mimeType: i.mimeType ?? "image/jpeg",
      bytes: positive(i.bytes, 0),
      width: positive(i.width, 0),
      height: positive(i.height, 0),
      beat: Math.max(0, Math.round(positive(i.beat, 0))),
      beats: Math.max(1, Math.round(positive(i.beats, 1))),
      // Absent before version 5, when every photo was fitted.
      fit: i.fit === "crop" ? "crop" : DEFAULT_IMAGE_FIT,
    });
  }
  return out;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
