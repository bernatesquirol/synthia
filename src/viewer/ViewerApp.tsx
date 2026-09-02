import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import * as storage from "../performance/storage";
import { chordSymbol } from "../music/chords";
import {
  chordAt,
  chordTimeline,
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
  const [performance] = useState<Performance | null>(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    return id ? storage.load(id) : storage.loadLatest();
  });

  if (!performance) {
    return (
      <div class="screen">
        <Header />
        <div class="card">
          <p class="muted">
            No performance found. Build one in the{" "}
            <a href="/performance_creator">creator</a> first.
          </p>
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
        <a href="/">Instrument</a>
        <a href="/performance_creator">Creator</a>
      </nav>
    </header>
  );
}

function Stage({ performance }: { performance: Performance }) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);

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
      const tick = (ts: number) => {
        if (ts - last > 80) {
          last = ts;
          setNow(p.getCurrentTime());
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
  }, [performance.youtubeId]);

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
              <span class="grow">{line.text}</span>
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
