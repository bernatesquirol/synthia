import { useEffect, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { readVersionFromUrl } from "../persistence";
import { RemoteStore } from "../performance/remote";
import * as storage from "../performance/storage";
import type { Performance } from "../performance/types";

export type DocState =
  | { phase: "loading" }
  | { phase: "ready"; performance: Performance }
  | { phase: "missing" }
  | { phase: "failed"; message: string };

/**
 * The performance this URL names, from wherever it can be had.
 *
 * Anything already in this browser wins, so a piece can be looked at offline
 * and without a configured endpoint. A `?v=` pin always goes to the store,
 * since localStorage only ever holds the working copy — a pinned link is a
 * promise about which version you are seeing, and the working copy cannot
 * keep it.
 *
 * Shared by the two published views — the performance itself and the lyric
 * sheet — which differ in what they do with the document, not in how they
 * find it.
 */
export function usePerformanceDoc(): DocState {
  const id = new URLSearchParams(window.location.search).get("id");
  const version = readVersionFromUrl();

  const [state, setState] = useState<DocState>(() => {
    if (version) return { phase: "loading" };
    const local = id ? storage.load(id) : storage.loadLatest();
    return local
      ? { phase: "ready", performance: local }
      : { phase: "loading" };
  });

  useEffect(() => {
    if (state.phase === "ready") return;
    if (!id) {
      setState({ phase: "missing" });
      return;
    }
    let cancelled = false;
    const remote = new RemoteStore(loadConfig());
    if (!remote.enabled) {
      setState({ phase: "missing" });
      return;
    }
    remote
      .fetch(id, version ?? undefined)
      .then((doc) => {
        if (cancelled) return;
        setState(
          doc ? { phase: "ready", performance: doc } : { phase: "missing" },
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[viewer] remote fetch failed", err);
        setState({
          phase: "failed",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
    // Resolving once on mount is intended; the id comes from the URL.
  }, []);

  return state;
}

/** The same piece and version, as a link to the other published view. */
export function siblingLink(path: string): string {
  const params = new URLSearchParams(window.location.search);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
