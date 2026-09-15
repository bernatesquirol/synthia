/**
 * The workshop's clock.
 *
 * In step 1 the YouTube video is in charge and the backing track chases it,
 * which is how the track's offset gets calibrated. Step 2 inverts that: the
 * finished piece has no video in it, so the backing track *is* the clock and
 * everything else — the slideshow, the lyric, the scrolling — reads from it.
 *
 * With no track uploaded yet the clock still runs, silently, off
 * `requestAnimationFrame`. A silent transport is not much of a rehearsal, but
 * it keeps the whole screen usable for laying photos onto beats before the
 * audio exists, instead of showing a dead player.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { loadAsset } from "./assets";
import type { RemoteStore } from "./remote";
import type { BackingTrack } from "./types";

export type ClockSource = "backing" | "silent";
export type ClockStatus = "loading" | "ready" | "error";

export interface WorkshopClock {
  source: ClockSource;
  status: ClockStatus;
  error: string;
  playing: boolean;
  /** Live position on the performance timeline. Safe to read every frame. */
  time(): number;
  /** Length of the piece in seconds. */
  duration: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
}

export function useWorkshopClock(
  performanceId: string,
  track: BackingTrack | null,
  fallbackDuration: number,
  remote: RemoteStore,
): WorkshopClock {
  const audio = useRef<HTMLAudioElement | null>(null);
  /** Position for the silent transport, in performance-timeline seconds. */
  const silent = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<ClockStatus>(
    track ? "loading" : "ready",
  );
  const [error, setError] = useState("");
  const [audioLength, setAudioLength] = useState(0);

  // Read by callbacks that must not be rebuilt when only the mix changes.
  const offset = track?.offset ?? 0;
  const latest = useRef({ offset, gain: track?.gain ?? 1 });
  latest.current = { offset, gain: track?.gain ?? 1 };

  const key = track?.key ?? "";
  const mimeType = track?.mimeType ?? "";

  useEffect(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(false);

    if (!key) {
      setStatus("ready");
      setError("");
      setAudioLength(0);
      return;
    }

    let cancelled = false;
    let url = "";
    setStatus("loading");
    setError("");

    loadAsset(remote, performanceId, key)
      .then(async (blob) => {
        if (cancelled) return;
        if (!blob) {
          throw new Error(
            "The backing track is missing from storage. Re-upload it in " +
              "step 1.",
          );
        }
        url = URL.createObjectURL(
          mimeType ? blob.slice(0, blob.size, mimeType) : blob,
        );
        const element = new Audio();
        element.preload = "auto";
        element.src = url;
        await whenLoaded(element);
        if (cancelled) return;

        element.volume = clamp01(latest.current.gain);
        // The transport owns play/pause, but the element can stop on its own
        // at the end of the file; keep the button honest about it.
        element.addEventListener("ended", () => setPlaying(false));
        element.addEventListener("pause", () => setPlaying(false));
        element.addEventListener("play", () => setPlaying(true));
        // Pick up wherever the silent transport had got to.
        element.currentTime = Math.max(0, silent.current - offset);

        audio.current = element;
        setAudioLength(
          Number.isFinite(element.duration) ? element.duration : 0,
        );
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      audio.current?.pause();
      audio.current = null;
      if (url) URL.revokeObjectURL(url);
    };
    // `offset` is read through the ref; re-running on it would reload the file
    // on every nudge of the offset control.
  }, [performanceId, key, mimeType, remote]);

  useEffect(() => {
    if (audio.current) audio.current.volume = clamp01(track?.gain ?? 1);
  }, [track?.gain, status]);

  const duration = Math.max(
    fallbackDuration,
    audioLength > 0 ? audioLength + offset : 0,
  );

  const time = useCallback(() => {
    const element = audio.current;
    if (element) return element.currentTime + latest.current.offset;
    return silent.current;
  }, []);

  const seek = useCallback((seconds: number) => {
    const wanted = Math.max(0, seconds);
    silent.current = wanted;
    const element = audio.current;
    if (!element) return;
    const inTrack = wanted - latest.current.offset;
    element.currentTime = Math.max(
      0,
      Math.min(
        Number.isFinite(element.duration) ? element.duration : wanted,
        inTrack,
      ),
    );
  }, []);

  const play = useCallback(() => {
    const element = audio.current;
    if (element) {
      // Rejected only when no gesture has unlocked audio; the transport is a
      // button, so by the time we are here there has been one.
      void element.play().catch(() => {});
      return;
    }
    setPlaying(true);
  }, []);

  const pause = useCallback(() => {
    const element = audio.current;
    if (element) element.pause();
    else setPlaying(false);
  }, []);

  // Advance the silent transport. The audio element keeps its own time, so
  // this loop only exists for the no-track case.
  useEffect(() => {
    if (!playing || audio.current) return;
    let raf = 0;
    let previous = performance.now();
    const step = (now: number) => {
      silent.current += (now - previous) / 1000;
      previous = now;
      if (duration > 0 && silent.current >= duration) {
        silent.current = duration;
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, status]);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  return {
    source: key ? "backing" : "silent",
    status,
    error,
    playing,
    time,
    duration,
    play,
    pause,
    toggle,
    seek,
  };
}

function whenLoaded(element: HTMLAudioElement): Promise<void> {
  if (element.readyState >= HTMLMediaElement.HAVE_METADATA)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      element.removeEventListener("loadedmetadata", onLoaded);
      element.removeEventListener("error", onError);
      fn();
    };
    const onLoaded = () => done(resolve);
    const onError = () =>
      done(() => reject(new Error("The backing track would not open.")));
    element.addEventListener("loadedmetadata", onLoaded);
    element.addEventListener("error", onError);
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}
