import { useEffect, useMemo, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { RemoteStore, type CatalogueEntry } from "../performance/remote";
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

/**
 * One performance, in however many places it exists.
 *
 * A song saved here and published to the store is one piece of work with two
 * copies, and they drift apart as a matter of course: saving writes here,
 * publishing writes there. Listing the two separately meant reading both lists
 * and matching titles by eye to work out which copy was ahead — and with two
 * drafts of the same song it was not even possible.
 */
interface Entry {
  id: string;
  title: string;
  artist: string;
  local: storage.SavedSummary | null;
  published: CatalogueEntry | null;
  /** Newer of the two timestamps, which is what the list is ordered by. */
  at: string;
}

/**
 * Save-then-publish writes the two timestamps moments apart, so exact equality
 * would almost never hold. Anything inside this counts as the same work.
 */
const IN_STEP_MS = 10_000;

/** First step: point the creator at a video, or reopen existing work. */
export function SourceStep({ onOpen }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  /** Two messages, because they belong under two different controls. */
  const [urlError, setUrlError] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const saved = useMemo(() => storage.listSaved(), [revision]);

  const remote = useMemo(() => new RemoteStore(loadConfig()), []);
  const [published, setPublished] = useState<CatalogueEntry[] | null>(null);

  useEffect(() => {
    if (!remote.enabled) return;
    remote
      .listCatalogue()
      .then(setPublished)
      .catch((err) => {
        console.warn("[creator] could not read the catalogue", err);
        setPublished([]);
      });
  }, [remote, revision]);

  const entries = useMemo(
    () => merge(saved, published ?? []),
    [saved, published],
  );

  async function start() {
    const id = parseYouTubeId(url);
    if (!id) {
      setUrlError("That does not look like a YouTube link or video id.");
      return;
    }
    setUrlError("");
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

  function openLocal(entry: Entry) {
    const doc = storage.load(entry.id);
    if (doc) onOpen(doc);
    else setError(`This browser's copy of "${entry.title}" will not open.`);
  }

  async function openPublished(entry: Entry) {
    setError("");
    try {
      const doc = await remote.fetch(entry.id);
      if (doc) onOpen(doc);
      else setError(`"${entry.title}" could not be fetched.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
        {urlError && <p class="error">{urlError}</p>}
      </div>

      <div class="card">
        <div class="row" style="margin-bottom:6px">
          <h2 style="margin:0">Performances</h2>
          <span class="grow" />
          {remote.enabled && published === null && (
            <span class="muted">reading the store…</span>
          )}
          {!remote.enabled && (
            <span class="muted">
              this browser only — no presign endpoint configured
            </span>
          )}
        </div>

        {entries.length === 0 ? (
          <p class="muted">Nothing here yet. Start one from a link above.</p>
        ) : (
          <ul class="results">
            {entries.map((entry) => {
              const where = describe(entry);
              return (
                <li key={entry.id}>
                  <span class="entry">
                    <span class="entry-title">
                      <strong>{entry.title || entry.id}</strong>
                      {entry.artist && (
                        <span class="muted">— {entry.artist}</span>
                      )}
                    </span>
                    <span class={where.tone}>{where.text}</span>
                  </span>

                  {entry.published && (
                    <span class="muted mono">
                      {entry.published.hash.slice(0, 8)}
                    </span>
                  )}
                  {entry.local?.readable && (
                    <button
                      class="sm primary"
                      title="Open this browser's copy"
                      onClick={() => openLocal(entry)}
                    >
                      Open
                    </button>
                  )}
                  {entry.published && (
                    <button
                      class="sm"
                      title="Fetch the published version and work from it"
                      onClick={() => openPublished(entry)}
                    >
                      {entry.local?.readable ? "Open published" : "Open"}
                    </button>
                  )}
                  {entry.local && (
                    <button
                      class="sm danger"
                      title={
                        entry.published
                          ? "Remove this browser's copy; published versions stay"
                          : "Remove it — this copy is the only one"
                      }
                      onClick={() => {
                        storage.remove(entry.id);
                        setRevision((n) => n + 1);
                      }}
                    >
                      Delete
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <label class="field" style="margin-top:12px">
          <span>Or import a performance .json</span>
          <input type="file" accept="application/json" onChange={importFile} />
        </label>
        {error && <p class="error">{error}</p>}
      </div>
    </>
  );
}

/** Local copies and published versions, matched up by performance id. */
function merge(
  saved: storage.SavedSummary[],
  published: CatalogueEntry[],
): Entry[] {
  const byId = new Map<string, Entry>();
  for (const local of saved) {
    byId.set(local.id, {
      id: local.id,
      title: local.title,
      artist: local.artist,
      local,
      published: null,
      at: local.updatedAt,
    });
  }
  for (const entry of published) {
    const existing = byId.get(entry.id);
    if (existing) {
      existing.published = entry;
      // The catalogue fills in what an unreadable local copy could not say.
      existing.title = existing.title || entry.title;
      existing.artist = existing.artist || entry.artist;
      if (entry.updatedAt > existing.at) existing.at = entry.updatedAt;
    } else {
      byId.set(entry.id, {
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        local: null,
        published: entry,
        at: entry.updatedAt,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Which copy is ahead, said plainly. This is the whole reason the two lists
 * became one: the answer decides which button you want.
 */
function describe(entry: Entry): { text: string; tone: string } {
  const { local, published } = entry;

  if (local && !local.readable) {
    return {
      tone: "error",
      text: published
        ? "the copy here is unreadable — open the published one"
        : "the copy here is unreadable, and it is the only one",
    };
  }
  if (local && published) {
    const skew = Date.parse(local.updatedAt) - Date.parse(published.updatedAt);
    if (Math.abs(skew) < IN_STEP_MS) {
      return {
        tone: "ok",
        text: `published and saved here, ${stamp(published.updatedAt)}`,
      };
    }
    if (skew > 0) {
      return {
        tone: "warn",
        text:
          `saved here ${stamp(local.updatedAt)} — newer than the published ` +
          `${stamp(published.updatedAt)}, so publish to catch up`,
      };
    }
    return {
      tone: "warn",
      text:
        `published ${stamp(published.updatedAt)} — newer than the copy here ` +
        `${stamp(local.updatedAt)}, so open the published one`,
    };
  }
  if (local) {
    return {
      tone: "muted",
      text: `saved here ${stamp(local.updatedAt)} · never published`,
    };
  }
  return {
    tone: "muted",
    text: `published ${stamp(entry.at)} · not in this browser yet`,
  };
}

/** Short and local: these are all recent, so the year is noise. */
function stamp(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "at an unknown time";
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
