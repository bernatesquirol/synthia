import { useEffect, useMemo, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { RemoteStore } from "../performance/remote";
import * as storage from "../performance/storage";
import { link } from "../router";
import type { Performance } from "../performance/types";
import { Editor } from "./Editor";
import { SourceStep } from "./SourceStep";

export function CreatorApp() {
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [savedAt, setSavedAt] = useState<string>("");
  const [publishState, setPublishState] = useState<string>("");
  const remote = useMemo(() => new RemoteStore(loadConfig()), []);

  async function publish(doc: Performance) {
    setPublishState("Publishing…");
    try {
      const hash = await remote.publish(doc);
      setPublishState(`Published ${hash}`);
    } catch (err) {
      // Most likely causes: no presign endpoint reachable, the endpoint
      // refused the key, or crypto.subtle is missing on a plain-HTTP origin.
      setPublishState(err instanceof Error ? err.message : String(err));
    }
  }

  // Autosave a moment after edits stop, so a refresh never loses work.
  useEffect(() => {
    if (!performance) return;
    const timer = setTimeout(() => {
      storage.save(performance);
      setSavedAt(new Date().toLocaleTimeString());
    }, 800);
    return () => clearTimeout(timer);
  }, [performance]);

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
                onClick={() => {
                  storage.save(performance);
                  setPerformance(null);
                }}
              >
                ← All performances
              </button>
              <span class="grow" />
              <span class="muted">
                {publishState ||
                  (savedAt ? `Saved ${savedAt}` : "Not saved yet")}
              </span>
              <button onClick={() => storage.downloadJson(performance)}>
                Export .json
              </button>
              <button
                onClick={() => {
                  storage.save(performance);
                  publish(performance);
                }}
                title={
                  remote.enabled
                    ? "Write a new version to the shared store"
                    : "No presign endpoint configured; publishing locally only"
                }
              >
                Publish
              </button>
              <button
                class="primary"
                onClick={() => {
                  storage.save(performance);
                  setSavedAt(new Date().toLocaleTimeString());
                }}
              >
                Save
              </button>
            </div>
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
