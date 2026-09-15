import { useEffect, useMemo, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { RemoteStore } from "../performance/remote";
import * as storage from "../performance/storage";
import { useUploads } from "../performance/uploads";
import { link } from "../router";
import type { Performance } from "../performance/types";
import { Editor } from "./Editor";
import { SourceStep } from "./SourceStep";

/** How long Save holds its confirmation before reading "Save" again. */
const CONFIRM_MS = 1800;

/** Whether the working copy in this browser is up to date with the editor. */
type SaveState =
  | { phase: "dirty" }
  | { phase: "saved"; at: string }
  | { phase: "failed"; message: string };

type PublishState =
  | { phase: "idle" }
  | { phase: "working" }
  /** `doc` is kept by identity, to spot edits made since it went up. */
  | { phase: "done"; hash: string; at: string; doc: Performance }
  | { phase: "failed"; message: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What went up alongside the document, so a publish can be checked at a
 * glance: the usual doubt after attaching audio is whether the snapshot
 * actually carries it.
 */
function attachments(doc: Performance): string {
  const parts: string[] = [];
  if (doc.backingTrack) parts.push(doc.backingTrack.filename);
  if (doc.images.length > 0) {
    parts.push(
      `${doc.images.length} photo${doc.images.length === 1 ? "" : "s"}`,
    );
  }
  return parts.length > 0 ? parts.join(" + ") : "lyrics only";
}

export function CreatorApp() {
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ phase: "dirty" });
  const [publishState, setPublishState] = useState<PublishState>({
    phase: "idle",
  });
  /** When Save was last pressed, which the button confirms for a moment. */
  const [confirmedAt, setConfirmedAt] = useState(0);
  const remote = useMemo(() => new RemoteStore(loadConfig()), []);
  const uploads = useUploads();

  function save(doc: Performance): void {
    try {
      storage.save(doc);
      setSaveState({ phase: "saved", at: new Date().toLocaleTimeString() });
    } catch (err) {
      // localStorage refuses the write once the origin's quota is full, and
      // losing an edit quietly is worse than anything it could say here.
      setSaveState({ phase: "failed", message: message(err) });
    }
  }

  async function publish(doc: Performance) {
    setPublishState({ phase: "working" });
    try {
      const hash = await remote.publish(doc);
      setPublishState({
        phase: "done",
        hash,
        at: new Date().toLocaleTimeString(),
        doc,
      });
    } catch (err) {
      // Most likely causes: no presign endpoint reachable, the endpoint
      // refused the key, or crypto.subtle is missing on a plain-HTTP origin.
      setPublishState({ phase: "failed", message: message(err) });
    }
  }

  // Autosave a moment after edits stop, so a refresh never loses work.
  useEffect(() => {
    if (!performance) return;
    setSaveState({ phase: "dirty" });
    const timer = setTimeout(() => save(performance), 800);
    return () => clearTimeout(timer);
  }, [performance]);

  useEffect(() => {
    if (confirmedAt === 0) return;
    const timer = setTimeout(() => setConfirmedAt(0), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmedAt]);

  const uploading = uploads.length > 0;
  const publishing = publishState.phase === "working";
  // Edits always produce a new document, so identity is enough to tell that
  // the published version has fallen behind what is on screen.
  const behind =
    publishState.phase === "done" && publishState.doc !== performance;

  return (
    <div class="screen">
      <header class="topbar">
        <h1>PERFORMANCE CREATOR</h1>
        <nav>
          <a href={link("/")}>Instrument</a>
          {performance && (
            <a
              href={link(
                `/performance?id=${encodeURIComponent(performance.id)}`,
              )}
            >
              Open in performance
            </a>
          )}
        </nav>
      </header>

      {performance === null ? (
        <SourceStep onOpen={setPerformance} />
      ) : (
        <>
          <div class="card">
            <div class="row">
              <button
                disabled={uploading}
                title={
                  uploading
                    ? "An upload is still running; leaving now would lose it"
                    : ""
                }
                onClick={() => {
                  save(performance);
                  setPerformance(null);
                }}
              >
                ← All performances
              </button>
              <span class="grow" />
              <span class={saveState.phase === "failed" ? "error" : "muted"}>
                {saveState.phase === "dirty"
                  ? "Unsaved changes…"
                  : saveState.phase === "saved"
                    ? `Saved ${saveState.at}`
                    : "Not saved to this browser"}
              </span>
              <button onClick={() => storage.downloadJson(performance)}>
                Export .json
              </button>
              <button
                disabled={publishing || uploading}
                onClick={() => {
                  save(performance);
                  publish(performance);
                }}
                title={
                  uploading
                    ? "Waiting for the upload: a version published now would " +
                      "name a file that is not in the store yet"
                    : remote.enabled
                      ? "Write a new version to the shared store"
                      : "No presign endpoint configured; publishing locally only"
                }
              >
                {publishing ? "Publishing…" : "Publish"}
              </button>
              <button
                class="primary"
                onClick={() => {
                  save(performance);
                  setConfirmedAt(Date.now());
                }}
              >
                {confirmedAt === 0 ? "Save" : "Saved ✓"}
              </button>
            </div>

            {uploading && (
              <p class="warn" style="margin:8px 0 0">
                {uploads.join(" · ")} — Publish waits until that lands.
              </p>
            )}
            {saveState.phase === "failed" && (
              <p class="error">{saveState.message}</p>
            )}
            {publishing && (
              <p class="muted" style="margin:8px 0 0">
                Hashing the document and writing the snapshot…
              </p>
            )}
            {publishState.phase === "done" && (
              <p class="ok" style="margin:8px 0 0">
                Published {publishState.at} · {attachments(performance)} ·{" "}
                <a
                  href={link(
                    `/performance?id=${encodeURIComponent(performance.id)}` +
                      `&v=${publishState.hash}`,
                  )}
                >
                  open version {publishState.hash.slice(0, 8)}
                </a>
                {!remote.enabled &&
                  " — in this browser only, no presign endpoint is configured"}
                {behind && " · edited since, so publish again to move the link"}
              </p>
            )}
            {publishState.phase === "failed" && (
              <p class="error">{publishState.message}</p>
            )}
          </div>
          <Editor
            performance={performance}
            update={(fn) => setPerformance((p) => (p ? fn(p) : p))}
          />
        </>
      )}
    </div>
  );
}
