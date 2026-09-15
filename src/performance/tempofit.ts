/**
 * Guessing the tempo instead of asking for it.
 *
 * Two independent sources, because they fail in opposite situations. The lyric
 * timings are sparse but already quantised by hand — someone tapped along to
 * the song — so a handful of them pins the tempo precisely and, unlike audio,
 * also says where the bar lines fall. The audio has no such help but knows the
 * whole piece, so it works before a single line has been timed.
 *
 * Both report a confidence, and both stay proposals: an estimate that silently
 * replaced a tempo the user had tapped would be worse than no estimate at all.
 */

/** Range searched by both methods. Wider than this is not music we expect. */
const MIN_BPM = 50;
const MAX_BPM = 200;

/**
 * Tempo is only ever determined up to a factor of two — a grid twice as fine
 * fits every downbeat the coarse one did — so near-equal candidates are
 * settled in favour of the slowest, which is the one with fewer bars per
 * phrase and the one a musician would name.
 */
const OCTAVE_TOLERANCE = 0.9;

export interface TempoGuess {
  bpm: number;
  /** Seconds of a downbeat, or null when the method cannot place one. */
  anchor: number | null;
  /** 0..1. Below `WEAK_FIT` the guess should not be trusted unchecked. */
  confidence: number;
  /** What it looked at, for the line shown beside the result. */
  detail: string;
}

/** Under this, say so rather than presenting a number as an answer. */
export const WEAK_FIT = 0.55;

// ------------------------------------------------------------ from the lyrics

/** Fewer than this and any tempo fits, so there is nothing to infer. */
const MIN_LINES = 4;

/**
 * Fit a bar grid to hand-timed line starts.
 *
 * Lines are sung from downbeats, so their times should all land near multiples
 * of one bar from a common origin. Both unknowns — the bar length and that
 * origin — come out at once by treating each time as an angle on a circle
 * whose circumference is one bar: when the bar length is right the angles
 * bunch together, and the direction they bunch in *is* the anchor. Scoring by
 * how tightly they bunch rather than by squared error means one badly timed
 * line pulls the answer a little instead of wrecking it.
 */
export function fitTempoToLines(
  times: number[],
  beatsPerBar: number,
): TempoGuess | null {
  const perBar = Math.max(1, beatsPerBar);
  const points = [...new Set(times.filter((t) => Number.isFinite(t) && t > 0))];
  if (points.length < MIN_LINES) return null;

  const barFor = (bpm: number) => (60 / bpm) * perBar;
  const scan: { bpm: number; strength: number; anchor: number }[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += 0.05) {
    scan.push({ bpm, ...concentration(points, barFor(bpm)) });
  }

  // Compare peaks rather than raw candidates. The strength curve is broad, so
  // a plain "first one above the threshold" walk settles on the lower flank of
  // the right peak and reports a tempo a couple of bpm slow.
  const peaks = scan.filter(
    (candidate, i) =>
      i > 0 &&
      i < scan.length - 1 &&
      candidate.strength >= scan[i - 1].strength &&
      candidate.strength > scan[i + 1].strength,
  );
  const strongest = (peaks.length > 0 ? peaks : scan).reduce((a, b) =>
    b.strength > a.strength ? b : a,
  );
  // Of the peaks that fit about as well, take the slowest: they are octaves
  // of one another and the slowest is the one a musician would name.
  const floor = strongest.strength * OCTAVE_TOLERANCE;
  const chosen =
    peaks.find((candidate) => candidate.strength >= floor) ?? strongest;

  // Songs are written at round tempos and this scan is not that precise, so
  // take the nearest whole bpm when it fits essentially as well.
  const whole = Math.round(chosen.bpm);
  const rounded =
    whole >= MIN_BPM && whole <= MAX_BPM
      ? { bpm: whole, ...concentration(points, barFor(whole)) }
      : null;
  const fit =
    rounded && rounded.strength >= chosen.strength * 0.98 ? rounded : chosen;

  // Turn the concentration back into the scatter that produced it, which is
  // what someone reading the result actually wants to know.
  const spread =
    (barFor(fit.bpm) / (2 * Math.PI)) *
    Math.sqrt(Math.max(0, -2 * Math.log(fit.strength)));

  return {
    bpm: round2(fit.bpm),
    anchor: round3(fit.anchor),
    confidence: fit.strength,
    detail:
      `${points.length} timed lines, ±${(spread * 1000).toFixed(0)}ms off the` +
      ` bar lines`,
  };
}

/**
 * How tightly `times` cluster on a grid of period `bar`, and where that grid
 * starts. Strength is 1 when every time sits exactly on a grid line and near
 * 0 when they are scattered evenly across it.
 */
function concentration(
  times: number[],
  bar: number,
): { strength: number; anchor: number } {
  let x = 0;
  let y = 0;
  for (const time of times) {
    const angle = 2 * Math.PI * (time / bar);
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  const strength = Math.hypot(x, y) / times.length;
  let anchor = (Math.atan2(y, x) / (2 * Math.PI)) * bar;
  // Report the first grid line at or after zero, so the grid covers the whole
  // piece instead of starting on a negative beat.
  while (anchor < 0) anchor += bar;
  return { strength, anchor };
}

// ------------------------------------------------------------- from the audio

/** Envelope resolution. ~12ms at the analysis rate, finer than the ear. */
const HOP = 128;
/** Decode rate: onsets survive it, and it keeps a whole song in memory. */
export const ANALYSIS_RATE = 11025;
/** Seconds of audio analysed. Long enough to average out a free intro. */
const ANALYSIS_SECONDS = 120;
/** Multiples of the beat period summed when scoring a candidate. */
const HARMONICS = [1, 2, 3, 4];

/**
 * Estimate the tempo from the music itself.
 *
 * The standard chain: reduce the audio to an onset strength curve,
 * autocorrelate that curve to find the period the onsets repeat at, then find
 * the phase of the pulse train that lines up with them. Onset strength here is
 * the frame-to-frame rise in loudness, which is cruder than a spectral flux
 * but needs no FFT and is enough for anything with a drum or a strummed chord
 * in it.
 *
 * `samples` must be mono; the rate is free, though `ANALYSIS_RATE` is what the
 * decode path produces.
 */
export function estimateTempoFromSamples(
  samples: Float32Array,
  sampleRate: number,
  beatsPerBar: number,
): TempoGuess | null {
  const perBar = Math.max(1, beatsPerBar);
  const limit = Math.min(samples.length, sampleRate * ANALYSIS_SECONDS);
  const frames = Math.floor(limit / HOP);
  if (frames < 200) return null;

  const fps = sampleRate / HOP;
  const flux = onsetStrength(samples, frames);
  const auto = autocorrelate(flux);

  // Score each candidate by its own autocorrelation peak plus the peaks at its
  // multiples: a half-tempo candidate scores well on its own, but only the
  // true beat period has support at every multiple.
  let best = { bpm: 0, score: -Infinity };
  const scores: number[] = [];
  for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    let score = 0;
    for (const harmonic of HARMONICS) {
      score += interpolate(auto, lag * harmonic) / harmonic;
    }
    scores.push(score);
    if (score > best.score) best = { bpm, score };
  }

  // A flat autocorrelation means nothing periodic was found, so compare the
  // winner against the field rather than reporting its raw height.
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const deviation = Math.sqrt(
    scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length,
  );
  const confidence = clamp01((best.score - mean) / (4 * (deviation || 1)));

  const beatLag = (60 / best.bpm) * fps;
  const beat = phaseOf(flux, beatLag);
  // Downbeats carry more weight than the beats between them, so of the
  // `perBar` ways the bar could align, take the strongest.
  let anchorFrame = beat;
  let strongest = -Infinity;
  for (let offset = 0; offset < perBar; offset++) {
    const at = beat + offset * beatLag;
    const weight = pulseTrain(flux, at, beatLag * perBar);
    if (weight > strongest) {
      strongest = weight;
      anchorFrame = at;
    }
  }

  return {
    bpm: round2(best.bpm),
    anchor: round3(anchorFrame / fps),
    confidence,
    detail: `${(frames / fps).toFixed(0)}s of audio`,
  };
}

/** Frame-to-frame rise in loudness: quiet-to-loud is where a note starts. */
function onsetStrength(samples: Float32Array, frames: number): Float32Array {
  const flux = new Float32Array(frames);
  let previous = 0;
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const from = i * HOP;
    for (let j = from; j < from + HOP; j++) sum += samples[j] * samples[j];
    // Loudness rather than raw power, so a loud chorus does not outvote a
    // quiet verse with the same beat in it.
    const level = Math.log1p(1000 * Math.sqrt(sum / HOP));
    flux[i] = Math.max(0, level - previous);
    previous = level;
  }

  // Centre it: a curve with an offset correlates with everything.
  let mean = 0;
  for (const value of flux) mean += value;
  mean /= frames;
  for (let i = 0; i < frames; i++) flux[i] -= mean;
  return flux;
}

/** Normalised autocorrelation, indexed by lag in frames. */
function autocorrelate(flux: Float32Array): Float32Array {
  const maxLag = Math.min(flux.length >> 1, 4096);
  const auto = new Float32Array(maxLag);
  let energy = 0;
  for (const value of flux) energy += value * value;
  if (energy === 0) return auto;

  for (let lag = 1; lag < maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < flux.length; i++) sum += flux[i] * flux[i - lag];
    auto[lag] = sum / energy;
  }
  return auto;
}

/** Offset in frames of the pulse train of period `lag` that fits best. */
function phaseOf(flux: Float32Array, lag: number): number {
  let best = 0;
  let strongest = -Infinity;
  // Quarter-frame steps: a beat does not land on a frame boundary.
  for (let phase = 0; phase < lag; phase += 0.25) {
    const weight = pulseTrain(flux, phase, lag);
    if (weight > strongest) {
      strongest = weight;
      best = phase;
    }
  }
  return best;
}

/** Total onset strength under a pulse train of one period and phase. */
function pulseTrain(flux: Float32Array, phase: number, lag: number): number {
  let sum = 0;
  for (let at = phase; at < flux.length; at += lag)
    sum += interpolate(flux, at);
  return sum;
}

/** Linear read at a fractional index; 0 outside the array. */
function interpolate(values: ArrayLike<number>, at: number): number {
  if (at < 0 || at >= values.length - 1) return 0;
  const low = Math.floor(at);
  const fraction = at - low;
  return values[low] * (1 - fraction) + values[low + 1] * fraction;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Guess the tempo of a backing track from its bytes.
 *
 * The one-frame offline context is only there to borrow its decoder:
 * `decodeAudioData` resamples to the context's own rate, which is how the
 * analysis gets mono at 11 kHz without caring what the file was encoded at.
 * That resampling is the whole reason this is affordable — a five-minute song
 * arrives as a few MB of floats rather than fifty.
 */
export async function guessTempoFromAudio(
  blob: Blob,
  beatsPerBar: number,
): Promise<TempoGuess | null> {
  const bytes = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const buffer = await context.decodeAudioData(bytes);
  return estimateTempoFromSamples(
    downmix(buffer),
    buffer.sampleRate,
    beatsPerBar,
  );
}

/** One channel to analyse. Stereo detail is irrelevant to an onset curve. */
function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}
