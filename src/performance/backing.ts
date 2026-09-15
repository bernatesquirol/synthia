/**
 * Backing tracks: getting an audio file into storage, and keeping it in step
 * with the YouTube player once it is there.
 *
 * The two clocks are independent — YouTube owns the video's, the browser owns
 * the `<audio>` element's — so they cannot simply be started together and
 * trusted. Instead the audio follows the video: every frame we compare where
 * the track is against where the video says it should be, and correct.
 */
import { hashBytes } from "../persistence";
import { MAX_BACKING_BYTES, newBackingTrack, type BackingTrack } from "./types";

/** What the file picker offers. Anything the browser can play is allowed. */
export const BACKING_ACCEPT = "audio/*";

/** Give up measuring rather than leaving the creator spinning forever. */
const MEASURE_TIMEOUT_MS = 20_000;

export interface PreparedTrack {
  /** The bytes to upload, retyped so playback never depends on what S3 stored. */
  blob: Blob;
  /** Metadata for the document, including the key the blob belongs at. */
  track: BackingTrack;
}

/**
 * Hash, measure and name a picked file, without uploading it.
 *
 * Measuring goes through an `<audio>` element rather than `decodeAudioData`
 * because playback will go through one too: a file the element cannot open is
 * useless to us however well WebAudio decodes it, and this way we find that
 * out before anything reaches the bucket.
 */
export async function prepareBackingTrack(file: File): Promise<PreparedTrack> {
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);
  if (file.size > MAX_BACKING_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)}; the limit is ` +
        `${formatBytes(MAX_BACKING_BYTES)}. Export a smaller mp3.`,
    );
  }

  const bytes = await file.arrayBuffer();
  const mimeType = file.type || "audio/mpeg";
  const blob = new Blob([bytes], { type: mimeType });

  const duration = await measureAudio(blob);
  const hash = await hashBytes(bytes);

  return {
    blob,
    track: newBackingTrack({
      key: `audio/${hash}${extensionFor(file, mimeType)}`,
      filename: file.name,
      mimeType,
      bytes: file.size,
      duration,
    }),
  };
}

/** Playable length in seconds, or a throw explaining why we could not tell. */
export function measureAudio(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";

    const finish = (fn: () => void) => {
      window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      URL.revokeObjectURL(url);
      fn();
    };
    const onLoaded = () =>
      finish(() => {
        const seconds = audio.duration;
        // Infinity turns up for streamed or header-less files, where the
        // element genuinely does not know the length.
        if (!Number.isFinite(seconds) || seconds <= 0) {
          reject(new Error("That file has no readable length."));
        } else {
          resolve(seconds);
        }
      });
    const onError = () =>
      finish(() =>
        reject(
          new Error("This browser cannot play that file. Try mp3 or m4a."),
        ),
      );
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("Timed out reading that file."))),
      MEASURE_TIMEOUT_MS,
    );

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    audio.src = url;
  });
}

function extensionFor(file: File, mimeType: string): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1];
  if (fromName) return `.${fromName.toLowerCase()}`;
  const fromMime: Record<string, string> = {
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/flac": ".flac",
    "audio/webm": ".webm",
  };
  return fromMime[mimeType] ?? ".audio";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------- sync

/** Past this the track is audibly wrong, so take the click of a hard seek. */
const HARD_SEEK = 0.12;
/** Under this we leave it alone; correcting would cost more than it fixes. */
const SOFT_CORRECT = 0.04;
/** Rate trim ceiling. 2% is about 34 cents, at the edge of noticeable. */
const MAX_RATE_TRIM = 0.02;
/** How fast the drift estimate follows new samples, 0..1. */
const DRIFT_SMOOTHING = 0.25;

/**
 * Holds one `<audio>` element against the video's clock.
 *
 * Correction is in two bands. Small errors are absorbed by nudging
 * `playbackRate`, which is inaudible and leaves the audio continuous; large
 * ones — a scrub, a stall, a tab that was backgrounded — get a hard seek,
 * which is heard but converges immediately.
 */
export class BackingTrackSync {
  private drift = 0;

  constructor(
    private audio: HTMLAudioElement,
    private offset: number,
    gain: number,
  ) {
    audio.volume = clamp01(gain);
    // Let pitch move with the rate trim: at 2% a time-stretcher's artefacts
    // are more noticeable than the pitch shift, and cost more to produce.
    audio.preservesPitch = false;
  }

  setOffset(offset: number): void {
    this.offset = Number.isFinite(offset) ? offset : 0;
  }

  setGain(gain: number): void {
    this.audio.volume = clamp01(gain);
  }

  /** Smoothed seconds the track is ahead of where it should be. */
  getDrift(): number {
    return this.audio.paused ? 0 : this.drift;
  }

  /** Call once per animation frame with the video's own clock. */
  follow(videoTime: number, videoPlaying: boolean): void {
    const audio = this.audio;
    const target = videoTime - this.offset;
    const length = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    // Stop a hair short of the end: a track shorter than the video would
    // otherwise be restarted and re-ended on every frame of the overhang.
    const inRange = target >= 0 && target < length - 0.05;

    if (!videoPlaying || !inRange) {
      if (!audio.paused) audio.pause();
      audio.playbackRate = 1;
      this.drift = 0;
      // Park the head where the video is, so resuming does not start with a
      // seek the listener hears.
      if (
        inRange &&
        !audio.seeking &&
        Math.abs(audio.currentTime - target) > SOFT_CORRECT
      ) {
        audio.currentTime = target;
      }
      return;
    }

    if (audio.paused) {
      audio.currentTime = target;
      this.drift = 0;
      // Rejected when no gesture has unlocked audio yet; the next frame with
      // the video still playing tries again, which is the behaviour we want.
      void audio.play().catch(() => {});
      return;
    }
    // Mid-seek the reported position is the destination, not the truth.
    if (audio.seeking) return;

    const sample = audio.currentTime - target;
    // The video clock is quantised, so one sample says little. Smoothing
    // stops the rate trim hunting on jitter that is not really drift.
    this.drift += (sample - this.drift) * DRIFT_SMOOTHING;
    const magnitude = Math.abs(this.drift);

    if (magnitude > HARD_SEEK) {
      audio.currentTime = target;
      audio.playbackRate = 1;
      this.drift = 0;
    } else if (magnitude > SOFT_CORRECT) {
      // Ahead of the video means slow down, hence the sign.
      const trim = clamp(this.drift * 0.5, -MAX_RATE_TRIM, MAX_RATE_TRIM);
      audio.playbackRate = 1 - trim;
    } else {
      audio.playbackRate = 1;
    }
  }

  stop(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 1, 0, 1);
}
