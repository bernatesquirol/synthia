import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadConfig } from "../config";
import {
  linesFromPlainText,
  parseLrc,
  searchLyrics,
  type LrcTrack,
} from "../performance/lrclib";
import { RemoteStore } from "../performance/remote";
import {
  shiftFrom,
  spreadTies,
  timingProblems,
  type TimingProblem,
} from "../performance/timing";
import {
  useBackingTrack,
  type BackingStatus,
} from "../performance/useBackingTrack";
import {
  formatTime,
  lineIndexAt,
  newLine,
  type Performance,
  type PerformanceLine,
} from "../performance/types";
import {
  createPlayer,
  parseYouTubeId,
  PLAYER_STATE,
  type YouTubePlayer,
} from "../performance/youtube";
import { BackingTrackPanel } from "./BackingTrackPanel";
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

export function SourcePanel({ performance, update }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);

  const [now, setNow] = useState(0);
  /** Live clock, for handlers inside the memoised list. */
  const nowRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  /** True once the iframe player exists, which gates calls into it. */
  const [ready, setReady] = useState(false);

  /**
   * What you hear right now, as two independent switches.
   *
   * This is monitoring, not the piece's mix: the video is the clock either
   * way, and `backingTrack.muteVideo` still decides what the finished
   * performance plays. Here you want all three combinations — the video
   * alone to hear the original, the track alone to hear the replacement, and
   * both together to line them up — without editing the document to get
   * them. Starting from the stored mix means the default is what the piece
   * will actually sound like.
   */
  const [hearVideo, setHearVideo] = useState(
    () => !(performance.backingTrack?.muteVideo ?? false),
  );
  const [hearTrack, setHearTrack] = useState(true);
  /** Read inside the once-per-video animation frame loop. */
  const hearTrackRef = useRef(hearTrack);
  hearTrackRef.current = hearTrack;

  const videoId = performance.youtubeId;

  const remote = useMemo(() => new RemoteStore(loadConfig()), []);
  const backing = useBackingTrack(
    performance.id,
    performance.backingTrack,
    remote,
  );
  // The clock tick below is set up once per video, long before the audio
  // loads, so it reaches the current handle through a ref rather than
  // capturing whichever one existed at mount.
  const followBacking = useRef(backing.follow);
  followBacking.current = backing.follow;

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
      setReady(true);

      // Poll rather than re-render per frame; 10Hz is enough to drive the
      // clock and the active-line highlight.
      const tick = (ts: number) => {
        nowRef.current = p.getCurrentTime();
        // Every frame, unlike the state below: the backing track can only be
        // corrected as finely as the clock it is compared against.
        followBacking.current(
          nowRef.current,
          p.getPlayerState() === PLAYER_STATE.playing && hearTrackRef.current,
        );
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
      setReady(false);
      host.replaceChildren();
    };
  }, [videoId]);

  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    // Taken literally, including the case where both switches are off: the
    // readout below says what you will hear, so silence is never a mystery.
    if (hearVideo) p.unMute();
    else p.mute();
  }, [ready, hearVideo]);

  // The duration is only known once the player has loaded metadata.
  useEffect(() => {
    const d = player.current?.getDuration() ?? 0;
    if (d > 0) update((p) => (p.duration > 0 ? p : { ...p, duration: d }));
  }, [now, update]);

  const lines = performance.lines;
  const problems = useMemo(() => timingProblems(lines), [lines]);
  const problemAt = useMemo(() => {
    const map = new Map<number, "tie" | "back">();
    for (const problem of problems) map.set(problem.index, problem.kind);
    return map;
  }, [problems]);

  /** The last single-line retime, offered as a shift for everything after. */
  const [retimed, setRetimed] = useState<{
    index: number;
    delta: number;
  } | null>(null);

  function setLines(next: PerformanceLine[]) {
    update((p) => ({ ...p, lines: next }));
  }

  function updateLine(index: number, line: PerformanceLine) {
    // `lines` here is the array this handler was built against — the list is
    // memoised on it — so the old time is the one actually on screen.
    const previous = lines[index];
    if (previous && previous.time !== line.time) {
      setRetimed({ index, delta: line.time - previous.time });
    }
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
            problem={problemAt.get(i)}
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
    [lines, activeIndex, cursor, problemAt],
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

          <Monitor
            hearVideo={hearVideo}
            hearTrack={hearTrack}
            onVideo={setHearVideo}
            onTrack={setHearTrack}
            status={backing.status}
          />
        </div>

        <div>
          <div class="card">
            <h2>Details</h2>
            <label class="field">
              <span>YouTube link or video id — the source, not the result</span>
              <input
                type="text"
                value={performance.youtubeId}
                title="Where the original lyrics and their timings come from"
                onChange={(e) => {
                  const parsed = parseYouTubeId(e.currentTarget.value);
                  if (parsed) update((p) => ({ ...p, youtubeId: parsed }));
                  else e.currentTarget.value = performance.youtubeId;
                }}
              />
            </label>
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

          <TapPanel
            cursor={cursor}
            total={lines.length}
            onTap={tap}
            onReset={() => setCursor(0)}
            onCursor={setCursor}
          />
        </div>
      </div>

      <BackingTrackPanel
        performance={performance}
        update={update}
        remote={remote}
        backing={backing}
      />

      <LyricsPanel performance={performance} onLines={setLines} />

      <div class="card">
        <h2>Original lyrics · {lines.length} lines</h2>

        <TimingBar
          problems={problems}
          total={lines.length}
          retimed={retimed}
          onSpread={() => {
            setLines(spreadTies(lines));
            setRetimed(null);
          }}
          onSort={() => setLines([...lines].sort((a, b) => a.time - b.time))}
          onShiftRest={() => {
            if (!retimed) return;
            setLines(shiftFrom(lines, retimed.index + 1, retimed.delta));
            setRetimed(null);
          }}
          onDismiss={() => setRetimed(null)}
        />

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
 * What you are listening to, said in words rather than left to be inferred
 * from two mute buttons. The video is always the clock; these only decide
 * which of the two audio sources reaches the speakers.
 */
function Monitor({
  hearVideo,
  hearTrack,
  onVideo,
  onTrack,
  status,
}: {
  hearVideo: boolean;
  hearTrack: boolean;
  onVideo: (on: boolean) => void;
  onTrack: (on: boolean) => void;
  status: BackingStatus;
}) {
  const trackAudible = hearTrack && status === "ready";
  const where = (() => {
    if (hearVideo && trackAudible) {
      return { tone: "ok", text: "both, so you can line them up" };
    }
    if (trackAudible) return { tone: "ok", text: "the backing track only" };
    if (hearVideo) return { tone: "ok", text: "the video only" };
    if (hearTrack && status === "loading") {
      return { tone: "muted", text: "nothing yet — the track is loading" };
    }
    if (hearTrack && status === "error") {
      return { tone: "error", text: "nothing — the track will not play" };
    }
    if (hearTrack && status === "none") {
      return { tone: "muted", text: "nothing — there is no backing track yet" };
    }
    return { tone: "warn", text: "nothing — both sources are off" };
  })();

  return (
    <div class="row" style="margin-top:8px">
      <span class="muted">Hearing</span>
      <button
        class={"sm toggle" + (hearVideo ? " on" : "")}
        title="The video's own audio"
        onClick={() => onVideo(!hearVideo)}
      >
        Video
      </button>
      <button
        class={"sm toggle" + (hearTrack ? " on" : "")}
        disabled={status === "none"}
        title={
          status === "none"
            ? "Attach a backing track below first"
            : "The backing track, kept in step with the video"
        }
        onClick={() => onTrack(!hearTrack)}
      >
        Track
      </button>
      <span class={where.tone}>{where.text}</span>
    </div>
  );
}

/**
 * Times that cannot both be true, and the two ways out of them.
 *
 * Lines sharing a time are the common one — inserting a line copies the time
 * above it, and an .lrc can hold two lines on one stamp — and they read in
 * the score as a row with no length. Separately, retiming a single line is
 * usually the first half of a fix: when a verse came in late, everything
 * after it did too, so the move is offered again for the rest of the song.
 */
function TimingBar({
  problems,
  total,
  retimed,
  onSpread,
  onSort,
  onShiftRest,
  onDismiss,
}: {
  problems: TimingProblem[];
  total: number;
  retimed: { index: number; delta: number } | null;
  onSpread: () => void;
  onSort: () => void;
  onShiftRest: () => void;
  onDismiss: () => void;
}) {
  const ties = problems.filter((p) => p.kind === "tie").length;
  const backs = problems.filter((p) => p.kind === "back").length;
  const after = retimed ? total - retimed.index - 1 : 0;
  const delta = retimed?.delta ?? 0;

  return (
    <>
      {problems.length > 0 && (
        <p class="warn" style="margin:0 0 8px">
          {ties > 0 &&
            `${ties} line${ties === 1 ? "" : "s"} share a time with the one above`}
          {ties > 0 && backs > 0 && " · "}
          {backs > 0 && `${backs} line${backs === 1 ? "" : "s"} run backwards`}
          {" — marked in red below. "}
          {ties > 0 && (
            <button
              class="sm"
              title="Spread each tied run over the space up to the next time"
              onClick={onSpread}
            >
              Spread ties
            </button>
          )}
          {backs > 0 && (
            <button class="sm" onClick={onSort}>
              Sort by time
            </button>
          )}
        </p>
      )}

      {retimed && after > 0 && Math.abs(delta) >= 0.005 && (
        <p class="ok" style="margin:0 0 8px">
          Line {retimed.index + 1} moved {delta > 0 ? "+" : "−"}
          {Math.abs(delta).toFixed(2)}s.{" "}
          <button
            class="sm"
            title="Everything after it keeps its spacing and moves with it"
            onClick={onShiftRest}
          >
            Move the {after} line{after === 1 ? "" : "s"} after it too
          </button>{" "}
          <button class="sm" onClick={onDismiss}>
            Leave them
          </button>
        </p>
      )}
    </>
  );
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
