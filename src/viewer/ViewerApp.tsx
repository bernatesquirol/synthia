import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadConfig } from "../config";
import { link } from "../router";
import { useAssetUrls } from "../performance/assets";
import { useWorkshopClock } from "../performance/clock";
import { RemoteStore } from "../performance/remote";
import {
  displayText,
  formatTime,
  lineIndexAt,
  sortedLines,
  type Performance,
  type PerformanceLine,
} from "../performance/types";
import { PreviewStage } from "../stage/PreviewStage";
import { StageSlot, useStageWindow } from "../stage/StageWindow";
import { Transport } from "../stage/Transport";
import { siblingLink, usePerformanceDoc } from "./usePerformanceDoc";

/** How long a hand scroll keeps the follow from taking the view back. */
const HOLD_MS = 4000;

/**
 * The published performance: the piece, and nothing of what made it.
 *
 * A visitor gets the picture and the words over it, on the backing track's
 * clock — no video, no score, no chords. The lyrics are here too, but folded
 * away: they are for following along or reading afterwards, and whoever wants
 * them can ask for them.
 */
export function ViewerApp() {
  const doc = usePerformanceDoc();

  if (doc.phase !== "ready") {
    return (
      <div class="screen">
        <Header />
        <div class="card">
          {doc.phase === "loading" ? (
            <p class="muted">Loading…</p>
          ) : doc.phase === "missing" ? (
            <p class="muted">
              No performance found. Build one in the{" "}
              <a href={link("/performance_creator")}>creator</a> first.
            </p>
          ) : (
            <p class="error">{doc.message}</p>
          )}
        </div>
      </div>
    );
  }
  return <Performing performance={doc.performance} />;
}

function Header({ performance }: { performance?: Performance }) {
  const title = performance?.title || "PERFORMANCE";
  return (
    <header class="topbar">
      <h1>{title.toUpperCase()}</h1>
      <nav>
        {performance && (
          <a href={link(siblingLink("/lyrics"))} target="_blank" rel="noopener">
            Lyric sheet
          </a>
        )}
        <a href={link("/performance_creator")}>Creator</a>
      </nav>
    </header>
  );
}

function Performing({ performance }: { performance: Performance }) {
  const remote = useMemo(() => new RemoteStore(loadConfig()), []);
  const clock = useWorkshopClock(
    performance.id,
    performance.backingTrack,
    performance.duration,
    remote,
  );

  const [now, setNow] = useState(0);
  /** Live clock, for handlers that must not go stale between renders. */
  const nowRef = useRef(0);
  const popout = useStageWindow();

  const lines = useMemo(() => sortedLines(performance), [performance.lines]);
  const assets = useMemo(
    () => performance.images.map((i) => ({ key: i.key, mimeType: i.mimeType })),
    [performance.images],
  );
  const urls = useAssetUrls(performance.id, assets, remote);

  // One poll for the screen, as in the workshop: the picture and the lyric
  // follow only need to be right to a tenth of a second.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      nowRef.current = clock.time();
      if (ts - last > 100) {
        last = ts;
        setNow(nowRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock.time]);

  // Space plays and pauses: the one control worth having without aiming.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        clock.toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeIndex = lineIndexAt(lines, now);
  const stage = (
    <PreviewStage
      performance={performance}
      time={now}
      urls={urls}
      lines={lines}
    />
  );

  return (
    <div class="screen">
      <Header performance={performance} />

      <div class="watch">
        <StageSlot win={popout.win} onClose={popout.toggle}>
          {stage}
        </StageSlot>
        <Transport
          playing={clock.playing}
          time={now}
          duration={clock.duration}
          onToggle={clock.toggle}
          onSeek={clock.seek}
          popped={popout.open}
          onPopOut={popout.toggle}
        />
        {popout.blocked && (
          <p class="warn">
            The browser blocked the stage window. Allow pop-ups for this page
            and try again.
          </p>
        )}
        {clock.status === "loading" && (
          <p class="muted">Loading the backing track…</p>
        )}
        {clock.status === "error" && <p class="error">{clock.error}</p>}
        {clock.status === "ready" && clock.source === "silent" && (
          <p class="warn">
            This version has no backing track, so it plays silently.
          </p>
        )}
      </div>

      <LyricPanel
        performance={performance}
        lines={lines}
        activeIndex={activeIndex}
        onSeek={clock.seek}
      />
    </div>
  );
}

/**
 * The words, folded away until asked for.
 *
 * Open, it follows the singing and any line can be jumped to, which makes it
 * a way around the piece as much as something to read. Closed, it gets out of
 * the way of the picture, which is the point of the page.
 */
function LyricPanel({
  performance,
  lines,
  activeIndex,
  onSeek,
}: {
  performance: Performance;
  lines: PerformanceLine[];
  activeIndex: number;
  onSeek: (seconds: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const heldUntil = useRef(0);

  // The line being sung scrolls itself into view, but only while the panel is
  // open: a closed panel has no layout to scroll, and would jump the moment
  // it was opened.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const container = box.current;
    if (!container) return;
    if (Date.now() < heldUntil.current) return;

    // The same placing as the score and the line list: the phrase being sung
    // sits second, with the one before it at the top — a line of context
    // behind, the rest of the song ahead.
    const anchor = lines[Math.max(0, activeIndex - 1)];
    const row = anchor ? rows.current.get(anchor.id) : null;
    if (!row) return;

    // Measured with rects rather than offsetTop: this panel is not a
    // positioned ancestor of its rows, so offsetTop would be counted from
    // somewhere up the page and send the scroll to the end of the list.
    const offset =
      row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const limit = container.scrollHeight - container.clientHeight;
    const top = Math.max(0, Math.min(limit, container.scrollTop + offset));
    const distance = Math.abs(top - container.scrollTop);
    if (distance < 1) return;
    container.scrollTo({
      top,
      // A seek can move the cursor by a whole song, and gliding that far
      // takes longer than the gap between two lines.
      behavior: distance > container.clientHeight ? "auto" : "smooth",
    });
  }, [open, activeIndex]);

  /** A hand scroll keeps the follow from taking the view back for a while. */
  function hold() {
    heldUntil.current = Date.now() + HOLD_MS;
  }

  return (
    <details
      class="card fold"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <h2>Lyrics</h2>
        <span class="muted grow">
          {lines.length} lines
          {performance.artist ? ` · ${performance.artist}` : ""}
        </span>
        <a href={link(siblingLink("/lyrics"))} target="_blank" rel="noopener">
          open the sheet
        </a>
      </summary>

      <div class="lines" ref={box} onWheel={hold} onPointerDown={hold}>
        {lines.map((line, i) => (
          <div
            key={line.id}
            class={"line" + (i === activeIndex ? " active" : "")}
            ref={(el) => {
              if (el) rows.current.set(line.id, el);
              else rows.current.delete(line.id);
            }}
          >
            <button
              class="time"
              title="Play from here"
              onClick={() => onSeek(line.time)}
            >
              {formatTime(line.time)}
            </button>
            <span />
            <span class="grow">{displayText(line)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
