import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { loadAsset } from "./assets";
import { BackingTrackSync } from "./backing";
import type { RemoteStore } from "./remote";
import type { BackingTrack } from "./types";

export type BackingStatus = "none" | "loading" | "ready" | "error";

export interface BackingHandle {
  status: BackingStatus;
  error: string;
  /** Drive from the host's clock tick; a no-op until the audio is ready. */
  follow(videoTime: number, videoPlaying: boolean): void;
  /** Smoothed sync error in seconds, for the creator's readout. */
  drift(): number;
}

/**
 * Load a performance's backing track and hand back something the host's
 * clock tick can drive. Returns a handle whose methods are stable across
 * renders, so a tick closure can capture them once.
 */
export function useBackingTrack(
  performanceId: string,
  track: BackingTrack | null,
  remote: RemoteStore,
): BackingHandle {
  const sync = useRef<BackingTrackSync | null>(null);
  const [status, setStatus] = useState<BackingStatus>(
    track ? "loading" : "none",
  );
  const [error, setError] = useState("");

  // Read inside the load effect, which must not re-run when only the mix
  // changes — the separate effects below push those through instead.
  const latest = useRef(track);
  latest.current = track;

  const key = track?.key ?? "";
  const mimeType = track?.mimeType ?? "";

  useEffect(() => {
    sync.current?.stop();
    sync.current = null;

    if (!key) {
      setStatus("none");
      setError("");
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
            "The backing track is missing from storage. Upload it again.",
          );
        }
        // Retype: what S3 hands back depends on how the object was stored,
        // and an element told a song is text/plain will not play it.
        url = URL.createObjectURL(
          mimeType ? blob.slice(0, blob.size, mimeType) : blob,
        );
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = url;
        await whenLoaded(audio);
        if (cancelled) return;
        sync.current = new BackingTrackSync(
          audio,
          latest.current?.offset ?? 0,
          latest.current?.gain ?? 1,
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
      sync.current?.stop();
      sync.current = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [performanceId, key, mimeType, remote]);

  // Both depend on `status` so a freshly built sync picks up the current mix.
  useEffect(() => {
    sync.current?.setOffset(track?.offset ?? 0);
  }, [track?.offset, status]);

  useEffect(() => {
    sync.current?.setGain(track?.gain ?? 1);
  }, [track?.gain, status]);

  const follow = useCallback((videoTime: number, videoPlaying: boolean) => {
    sync.current?.follow(videoTime, videoPlaying);
  }, []);

  const drift = useCallback(() => sync.current?.getDrift() ?? 0, []);

  return { status, error, follow, drift };
}

function whenLoaded(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA)
    return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
      fn();
    };
    const onLoaded = () => done(resolve);
    const onError = () =>
      done(() => reject(new Error("The backing track would not open.")));
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
  });
}
