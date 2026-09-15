import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { readVersionFromUrl } from "../persistence";
import { link } from "../router";
import { RemoteStore } from "../performance/remote";
import * as storage from "../performance/storage";
import { useBackingTrack } from "../performance/useBackingTrack";
import { chordSymbol } from "../music/chords";
import {
  chordAt,
  chordTimeline,
  displayText,
  formatTime,
  lineIndexAt,
  type Performance,
} from "../performance/types";
import {
  createPlayer,
  PLAYER_STATE,
  type YouTubePlayer,
} from "../performance/youtube";

/**
 * Placeholder performance screen. It proves the authored document round-trips
 * — player, synced lyrics and the chord timeline — and is the shell the real
 * playing surface will go into.
 */
export function ViewerApp() {
  const id = new URLSearchParams(window.location.search).get("id");
  const version = readVersionFromUrl();

  // Anything already in this browser wins, so authoring keeps working offline
  // and without a configured endpoint. A ?v= pin always goes to the store,
  // since localStorage only ever holds the working copy.
  const [performance, setPerformance] = useState<Performance | null>(() =>
    version ? null : id ? storage.load(id) : storage.loadLatest(),
  );
  const [status, setStatus] = useState(performance ? "" : "loading");

  useEffect(() => {
    if (performance || !id) {
      if (!performance) setStatus("missing");
      return;
    }
    let cancelled = false;
    const remote = new RemoteStore(loadConfig());
    if (!remote.enabled) {
      setStatus("missing");
      return;
    }
    remote
      .fetch(id, version ?? undefined)
      .then((doc) => {
        if (cancelled) return;
        if (doc) setPerformance(doc);
        else setStatus("missing");
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[viewer] remote fetch failed", err);
        setStatus(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Resolving once on mount is intended; the id comes from the URL.
  }, []);

  if (!performance) {
    return (
      <div class="screen">
        <Header />
        <div class="card">
          {status === "loading" ? (
            <p class="muted">Loading…</p>
          ) : status === "missing" ? (
            <p class="muted">
              No performance found. Build one in the{" "}
              <a href={link("/performance_creator")}>creator</a> first.
            </p>
          ) : (
            <p class="error">{status}</p>
          )}
        </div>
      </div>
    );
  }
  return <Stage performance={performance} />;
}

function Header() {
  return (
    <header class="topbar">
      <h1>PERFORMANCE</h1>
      <nav>
        <a href={link("/")}>Instrument</a>
        <a href={link("/performance_creator")}>Creator</a>
      </nav>
    </header>
  );
}

function Stage({ performance }: { performance: Performance }) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);

  const remote = useMemo(() => new RemoteStore(loadConfig()), []);
  const backing = useBackingTrack(
    performance.id,
    performance.backingTrack,
    remote,
  );
  // Reached through a ref because the clock tick is built once, before the
  // audio has loaded.
  const followBacking = useRef(backing.follow);
  followBacking.current = backing.follow;

  const lines = useMemo(
    () => [...performance.lines].sort((a, b) => a.time - b.time),
    [performance],
  );
  const chords = useMemo(() => chordTimeline(performance), [performance]);

  useEffect(() => {
    const host = holder.current;
    if (!host) return;
    let cancelled = false;
    let raf = 0;
    let last = 0;

    const slot = document.createElement("div");
    host.appendChild(slot);

    createPlayer(slot, performance.youtubeId, {
      onStateChange: (s) => setPlaying(s === PLAYER_STATE.playing),
    }).then((p) => {
      if (cancelled) {
        p.destroy();
        return;
      }
      player.current = p;
      setReady(true);
      const tick = (ts: number) => {
        const time = p.getCurrentTime();
        // Every frame: the backing track is corrected against this clock, so
        // throttling it here would coarsen the sync.
        followBacking.current(
          time,
          p.getPlayerState() === PLAYER_STATE.playing,
        );
        if (ts - last > 80) {
          last = ts;
          setNow(time);
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
  }, [performance.youtubeId]);

  // Silence the video only once the track is actually playable, so a backing
  // track that fails to load leaves the original audio rather than silence.
  const muteVideo = performance.backingTrack?.muteVideo ?? false;
  useEffect(() => {
    const p = player.current;
    if (!p || !ready) return;
    if (muteVideo && backing.status === "ready") p.mute();
    else p.unMute();
  }, [ready, muteVideo, backing.status]);

  const activeIndex = lineIndexAt(lines, now);
  const chord = chordAt(chords, now);

  return (
    <div class="screen">
      <Header />

      <div class="editor-top">
        <div>
          <div class="player-holder" ref={holder} />
          <div class="row" style="margin-top:10px">
            <button
              class="primary"
              onClick={() => {
                const p = player.current;
                if (!p) return;
                if (playing) p.pauseVideo();
                else p.playVideo();
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span class="clock">{formatTime(now)}</span>
          </div>
          {performance.backingTrack && (
            <p
              class={backing.status === "error" ? "error" : "muted"}
              style="margin-bottom:0"
            >
              {backing.status === "loading"
                ? "Loading the backing track…"
                : backing.status === "error"
                  ? backing.error
                  : `Backing track: ${performance.backingTrack.filename}`}
            </p>
          )}
        </div>

        <div class="card">
          <h2>Chord now</h2>
          <p style="font-size:38px;font-weight:700;margin:0">
            {chord ? chordSymbol(chord.root, chord.quality) : "—"}
          </p>
          <p class="muted">
            {chords.length} chord changes across {lines.length} lines
          </p>
        </div>
      </div>

      <div class="card">
        <h2>
          {performance.title || "Untitled"}
          {performance.artist ? ` · ${performance.artist}` : ""}
        </h2>
        <div class="lines">
          {lines.map((line, i) => (
            <div
              key={line.id}
              class={"line" + (i === activeIndex ? " active" : "")}
            >
              <span class="time">{formatTime(line.time)}</span>
              <span />
              <span class="grow">{displayText(line)}</span>
              <span class="muted">
                {line.chords
                  .slice()
                  .sort((a, b) => a.beat - b.beat)
                  .map((c) => chordSymbol(c.root, c.quality))
                  .join(" ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
