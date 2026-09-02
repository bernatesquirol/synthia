import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  linesFromPlainText,
  parseLrc,
  searchLyrics,
  type LrcTrack,
} from "../performance/lrclib";
import {
  formatTime,
  lineIndexAt,
  newLine,
  type Performance,
  type PerformanceLine,
} from "../performance/types";
import {
  createPlayer,
  PLAYER_STATE,
  type YouTubePlayer,
} from "../performance/youtube";
import { LineRow } from "./LineRow";

interface Props {
  performance: Performance;
  /**
   * Functional updates only. The line list is memoised, so a handler created
   * during one render can fire many renders later; spreading a captured
   * `performance` there would silently revert edits made in between.
   */
  update: (fn: (previous: Performance) => Performance) => void;
}

export function Editor({ performance, update }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);

  const [now, setNow] = useState(0);
  /** Live clock, for handlers inside the memoised list. */
  const nowRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);

  const videoId = performance.youtubeId;

  useEffect(() => {
    const host = holder.current;
    if (!host) return;

    let cancelled = false;
    let raf = 0;
    let lastTick = 0;

    // The API replaces the element it is given, so hand it a throwaway child.
    const slot = document.createElement("div");
    host.appendChild(slot);

    createPlayer(slot, videoId, {
      onStateChange: (state) => setPlaying(state === PLAYER_STATE.playing),
    }).then((p) => {
      if (cancelled) {
        p.destroy();
        return;
      }
      player.current = p;

      // Poll rather than re-render per frame; 10Hz is enough to drive the
      // clock and the active-line highlight.
      const tick = (ts: number) => {
        nowRef.current = p.getCurrentTime();
        if (ts - lastTick > 100) {
          lastTick = ts;
          setNow(nowRef.current);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      player.current?.destroy();
      player.current = null;
      host.replaceChildren();
    };
  }, [videoId]);

  // The duration is only known once the player has loaded metadata.
  useEffect(() => {
    const d = player.current?.getDuration() ?? 0;
    if (d > 0) update((p) => (p.duration > 0 ? p : { ...p, duration: d }));
  }, [now, update]);

  const lines = performance.lines;

  function setLines(next: PerformanceLine[]) {
    update((p) => ({ ...p, lines: next }));
  }

  function updateLine(index: number, line: PerformanceLine) {
    update((p) => ({
      ...p,
      lines: p.lines.map((l, i) => (i === index ? line : l)),
    }));
  }

  function seek(time: number) {
    player.current?.seekTo(Math.max(0, time), true);
  }

  /** Stamp the player's time onto the cursor line and advance. */
  function tap() {
    const t = player.current?.getCurrentTime() ?? nowRef.current;
    setCursor((c) => {
      if (c >= lines.length) return c;
      update((p) => ({
        ...p,
        lines: p.lines.map((l, i) => (i === c ? { ...l, time: t } : l)),
      }));
      return c + 1;
    });
  }

  // "t" taps, space toggles playback — but never while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tap();
      } else if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function togglePlay() {
    const p = player.current;
    if (!p) return;
    if (playing) p.pauseVideo();
    else p.playVideo();
  }

  const activeIndex = lineIndexAt(lines, now);

  // Returning a memoised vnode lets Preact skip diffing the whole list on the
  // 10Hz clock ticks, which otherwise dominates with a few hundred lines.
  const list = useMemo(
    () => (
      <div class="lines">
        {lines.map((line, i) => (
          <LineRow
            key={line.id}
            line={line}
            active={i === activeIndex}
            cursor={i === cursor}
            tempo={performance.tempo}
            getNow={() => nowRef.current}
            onSeek={seek}
            onChange={(l) => updateLine(i, l)}
            onDelete={() =>
              update((p) => ({
                ...p,
                lines: p.lines.filter((_, j) => j !== i),
              }))
            }
            onInsertAfter={() =>
              update((p) => {
                const next = [...p.lines];
                next.splice(i + 1, 0, newLine(line.time));
                return { ...p, lines: next };
              })
            }
          />
        ))}
      </div>
    ),
    // Deliberately not keyed on the clock: rows read it live through
    // `getNow`, so the list only re-diffs when the content, the tempo or the
    // highlighted row actually changes.
    [lines, activeIndex, cursor, performance.tempo],
  );

  return (
    <>
      <div class="editor-top">
        <div>
          <div class="player-holder" ref={holder} />
          <div class="row" style="margin-top:10px">
            <button class="primary" onClick={togglePlay}>
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={() => seek(now - 5)}>−5s</button>
            <button onClick={() => seek(now + 5)}>+5s</button>
            <span class="clock">{formatTime(now)}</span>
          </div>
        </div>

        <div>
          <div class="card">
            <h2>Details</h2>
            <div class="row">
              <label class="field grow">
                <span>Title</span>
                <input
                  type="text"
                  value={performance.title}
                  onInput={(e) => {
                    const title = e.currentTarget.value;
                    update((p) => ({ ...p, title }));
                  }}
                />
              </label>
              <label class="field grow">
                <span>Artist</span>
                <input
                  type="text"
                  value={performance.artist}
                  onInput={(e) => {
                    const artist = e.currentTarget.value;
                    update((p) => ({ ...p, artist }));
                  }}
                />
              </label>
            </div>
          </div>

          <TempoPanel performance={performance} update={update} />

          <TapPanel
            cursor={cursor}
            total={lines.length}
            onTap={tap}
            onReset={() => setCursor(0)}
            onCursor={setCursor}
          />
        </div>
      </div>

      <LyricsPanel performance={performance} onLines={setLines} />

      <div class="card">
        <h2>Lyrics document · {lines.length} lines</h2>
        {lines.length === 0 ? (
          <p class="muted">
            No lines yet — import lyrics above, or add one to start.
          </p>
        ) : (
          list
        )}
        <div class="row" style="margin-top:10px">
          <button
            onClick={() =>
              update((p) => ({
                ...p,
                lines: [...p.lines, newLine(nowRef.current)],
              }))
            }
          >
            + Add line
          </button>
          <button
            onClick={() =>
              update((p) => ({
                ...p,
                lines: [...p.lines].sort((a, b) => a.time - b.time),
              }))
            }
          >
            Sort by time
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Tempo drives the whole beat grid, so it lives above the document. Tap tempo
 * is usually faster than guessing a number.
 */
function TempoPanel({
  performance,
  update,
}: {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
}) {
  const taps = useRef<number[]>([]);
  const { bpm, beatsPerBar } = performance.tempo;

  function tapTempo() {
    const now = performance_now();
    // A long pause means a fresh count-in rather than a continuation.
    if (
      taps.current.length &&
      now - taps.current[taps.current.length - 1] > 2500
    ) {
      taps.current = [];
    }
    taps.current.push(now);
    if (taps.current.length > 8) taps.current.shift();
    if (taps.current.length < 2) return;

    const first = taps.current[0];
    const last = taps.current[taps.current.length - 1];
    const perBeat = (last - first) / (taps.current.length - 1);
    const next = Math.round(60000 / perBeat);
    if (next >= 30 && next <= 300) {
      update((p) => ({ ...p, tempo: { ...p.tempo, bpm: next } }));
    }
  }

  return (
    <div class="card">
      <h2>Tempo</h2>
      <div class="row">
        <label class="field" style="margin:0">
          <span>BPM</span>
          <input
            type="number"
            min="30"
            max="300"
            value={bpm}
            style="width:90px"
            onInput={(e) => {
              const value = Number(e.currentTarget.value);
              if (value >= 30 && value <= 300) {
                update((p) => ({ ...p, tempo: { ...p.tempo, bpm: value } }));
              }
            }}
          />
        </label>
        <label class="field" style="margin:0">
          <span>Beats per bar</span>
          <select
            value={String(beatsPerBar)}
            style="width:80px"
            onChange={(e) => {
              const value = Number(e.currentTarget.value);
              update((p) => ({
                ...p,
                tempo: { ...p.tempo, beatsPerBar: value },
              }));
            }}
          >
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={String(n)}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
        <button onClick={tapTempo}>Tap tempo</button>
      </div>
      <p class="muted" style="margin-bottom:0">
        One beat is {(60 / Math.max(1, bpm)).toFixed(3)}s. Each phrase gets one
        bar by default; use + on a row for a longer phrase or extra time.
      </p>
    </div>
  );
}

function performance_now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function TapPanel({
  cursor,
  total,
  onTap,
  onReset,
  onCursor,
}: {
  cursor: number;
  total: number;
  onTap: () => void;
  onReset: () => void;
  onCursor: (i: number) => void;
}) {
  return (
    <div class="card">
      <h2>Tap sync</h2>
      <p class="muted" style="margin-top:0">
        Play the video and hit <strong>T</strong> (or Tap) on each line as it is
        sung. Space plays and pauses.
      </p>
      <div class="row">
        <button class="primary" onClick={onTap} disabled={cursor >= total}>
          Tap
        </button>
        <button
          onClick={() => onCursor(Math.max(0, cursor - 1))}
          disabled={cursor === 0}
        >
          Back
        </button>
        <button onClick={onReset}>Reset</button>
        <span class="muted">
          {total === 0
            ? "no lines"
            : `line ${Math.min(cursor + 1, total)} of ${total}`}
        </span>
      </div>
    </div>
  );
}

function LyricsPanel({
  performance,
  onLines,
}: {
  performance: Performance;
  onLines: (lines: PerformanceLine[]) => void;
}) {
  const [track, setTrack] = useState(performance.title);
  const [artist, setArtist] = useState(performance.artist);
  const [results, setResults] = useState<LrcTrack[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");

  async function search() {
    setBusy(true);
    setError("");
    try {
      setResults(await searchLyrics(track, artist));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
    }
    setBusy(false);
  }

  function confirmReplace(count: number): boolean {
    if (performance.lines.length === 0) return true;
    return confirm(
      `Replace the ${performance.lines.length} existing lines with ${count} imported lines? Chords will be lost.`,
    );
  }

  function useTrack(t: LrcTrack) {
    const lines = t.syncedLyrics
      ? parseLrc(t.syncedLyrics)
      : linesFromPlainText(t.plainLyrics ?? "");
    if (lines.length === 0) {
      setError("That result has no usable lyrics.");
      return;
    }
    if (confirmReplace(lines.length)) onLines(lines);
  }

  function usePaste() {
    const text = paste.trim();
    if (!text) return;
    // Anything with an LRC stamp keeps its timings; otherwise tap-sync it.
    const lines = /\[\d{1,3}:\d{1,2}/.test(text)
      ? parseLrc(text)
      : linesFromPlainText(text);
    if (lines.length === 0) {
      setError("Could not read any lines from that text.");
      return;
    }
    if (confirmReplace(lines.length)) onLines(lines);
  }

  return (
    <div class="card">
      <h2>Lyrics</h2>
      <div class="row">
        <label class="field grow">
          <span>Track</span>
          <input
            type="text"
            value={track}
            onInput={(e) => setTrack(e.currentTarget.value)}
          />
        </label>
        <label class="field grow">
          <span>Artist</span>
          <input
            type="text"
            value={artist}
            onInput={(e) => setArtist(e.currentTarget.value)}
          />
        </label>
        <button onClick={search} disabled={busy}>
          {busy ? "Searching…" : "Search lrclib"}
        </button>
      </div>

      {results !== null && (
        <ul class="results">
          {results.length === 0 && <li class="muted">No matches.</li>}
          {results.map((t) => (
            <li key={t.id}>
              <span class="grow">
                {t.trackName} — {t.artistName}
                {t.albumName ? ` · ${t.albumName}` : ""}
              </span>
              {t.duration != null && (
                <span class="muted">{formatTime(t.duration)}</span>
              )}
              {t.syncedLyrics ? (
                <span class="synced">SYNCED</span>
              ) : (
                <span class="muted">plain</span>
              )}
              <button
                class="sm"
                disabled={!t.syncedLyrics && !t.plainLyrics}
                onClick={() => useTrack(t)}
              >
                Use
              </button>
            </li>
          ))}
        </ul>
      )}

      <details style="margin-top:12px">
        <summary class="muted">Paste lyrics or LRC instead</summary>
        <textarea
          style="margin-top:8px"
          placeholder={"[00:12.30] First line\nor just plain lines to tap-sync"}
          value={paste}
          onInput={(e) => setPaste(e.currentTarget.value)}
        />
        <button onClick={usePaste} disabled={!paste.trim()}>
          Use pasted text
        </button>
      </details>

      {error && <p class="error">{error}</p>}
    </div>
  );
}
