import { useMemo, useState } from "preact/hooks";
import * as storage from "../performance/storage";
import { emptyPerformance, type Performance } from "../performance/types";
import {
  fetchVideoInfo,
  guessTrackAndArtist,
  parseYouTubeId,
} from "../performance/youtube";

interface Props {
  onOpen: (performance: Performance) => void;
}

/** First step: point the creator at a video, or reopen existing work. */
export function SourceStep({ onOpen }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const saved = useMemo(() => storage.listPerformances(), [revision]);

  async function start() {
    const id = parseYouTubeId(url);
    if (!id) {
      setError("That does not look like a YouTube link or video id.");
      return;
    }
    setError("");
    setBusy(true);

    const performance = emptyPerformance(id);
    // oEmbed only prefills the lyrics lookup, so a failure is not fatal.
    try {
      const info = await fetchVideoInfo(id);
      const guess = guessTrackAndArtist(info.title, info.author);
      performance.title = guess.track;
      performance.artist = guess.artist;
    } catch (err) {
      console.warn("[creator] could not read video info", err);
    }
    setBusy(false);
    onOpen(performance);
  }

  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      onOpen(await storage.readJsonFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    input.value = "";
  }

  return (
    <>
      <div class="card">
        <h2>New performance</h2>
        <label class="field">
          <span>YouTube link or video id</span>
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onInput={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") start();
            }}
          />
        </label>
        <div class="row">
          <button
            class="primary"
            onClick={start}
            disabled={busy || !url.trim()}
          >
            {busy ? "Loading…" : "Start"}
          </button>
          <span class="muted">
            The video is the backing track; lyrics come next.
          </span>
        </div>
        {error && <p class="error">{error}</p>}
      </div>

      <div class="card">
        <h2>Open existing</h2>
        {saved.length === 0 ? (
          <p class="muted">Nothing saved in this browser yet.</p>
        ) : (
          <ul class="results">
            {saved.map((entry) => (
              <li key={entry.id}>
                <span class="grow">{entry.title || entry.id}</span>
                <button
                  class="sm"
                  onClick={() => {
                    const doc = storage.load(entry.id);
                    if (doc) onOpen(doc);
                    else setError(`Could not read "${entry.title}".`);
                  }}
                >
                  Open
                </button>
                <button
                  class="sm danger"
                  onClick={() => {
                    storage.remove(entry.id);
                    setRevision((n) => n + 1);
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <label class="field" style="margin-top:12px">
          <span>Or import a performance .json</span>
          <input type="file" accept="application/json" onChange={importFile} />
        </label>
      </div>
    </>
  );
}
