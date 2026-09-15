/**
 * Attachment uploads currently in flight, tracked in one place.
 *
 * Audio and photos are uploaded where they are picked — a panel deep inside
 * the editor — but it is the toolbar that has to know about them: a snapshot
 * published while a backing track is still going up names an object that is
 * not in the bucket yet, and the version reads as broken audio forever after.
 * Module scope lets those two talk without threading an upload flag through
 * every screen in between.
 */
import { useEffect, useState } from "preact/hooks";

export interface UploadHandle {
  /** Retitle the entry as the work moves from reading to uploading. */
  label(text: string): void;
  done(): void;
}

interface Entry {
  label: string;
}

const live: Entry[] = [];
const listeners = new Set<() => void>();
/** Rebuilt on every change, so subscribers get a new array to render. */
let snapshot: readonly string[] = [];

function announce(): void {
  snapshot = live.map((entry) => entry.label);
  for (const listener of listeners) listener();
}

export function beginUpload(label: string): UploadHandle {
  const entry: Entry = { label };
  live.push(entry);
  announce();

  let finished = false;
  return {
    label(text) {
      if (finished) return;
      entry.label = text;
      announce();
    },
    done() {
      if (finished) return;
      finished = true;
      const at = live.indexOf(entry);
      if (at >= 0) live.splice(at, 1);
      announce();
    },
  };
}

/** Labels of everything still uploading, for whoever needs to wait on it. */
export function useUploads(): readonly string[] {
  const [uploads, setUploads] = useState(snapshot);

  useEffect(() => {
    const listener = () => setUploads(snapshot);
    listeners.add(listener);
    // An upload may have started between this render and this effect.
    listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return uploads;
}
