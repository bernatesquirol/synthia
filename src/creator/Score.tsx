import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { chordSymbol } from "../music/chords";
import { IMAGE_ACCEPT, imageFilesFrom } from "../performance/images";
import {
  beatAt,
  beatTime,
  displayText,
  formatTime,
  phrases,
  type Performance,
  type Phrase,
  type TimelineImage,
} from "../performance/types";

interface Props {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  urls: Map<string, string>;
  /** Live clock read, for the playhead. Called every frame. */
  getTime: () => number;
  onSeek: (seconds: number) => void;
  duration: number;
  activeLineId: string | null;
  /** Upload and place; the score does not talk to storage itself. */
  onAddImages: (files: File[], beat: number) => void;
  busy: string;
}

type DragMode = "move" | "resize";

interface DragState {
  id: string;
  mode: DragMode;
  /** Beats between the image's start and where the pointer took hold. */
  grab: number;
}

const ZOOMS = [10, 16, 24, 34, 48, 68];
const DEFAULT_ZOOM = 2;
/**
 * Bars the beats column is sized for. Every row gets that same width whatever
 * its length, the way a stave wraps into systems of equal width rather than
 * ragged ones, so the column has one edge down the whole score and a long row
 * costs density instead of horizontal scrolling.
 */
const COLUMN_BARS = 4;
/** Past this a beat is too narrow to drop a photo on, so let the row spill. */
const MIN_PX_PER_BEAT = 3;
/** How long a hand scroll keeps the follow from taking the view back. */
const HOLD_MS = 4000;

/**
 * The score: one row per phrase, lyric on the left, that phrase's beats on
 * the right.
 *
 * Wrapping the grid per phrase rather than drawing it as one long line is
 * what makes a beat legible — you can see which words a photo lands under.
 * The grid itself stays continuous underneath, so a photo is still just a
 * start beat and a length, and one that outlasts its phrase is drawn as a
 * segment in each row it crosses rather than being cut short at the edge.
 *
 * The lyric column is sticky, so the whole thing shares one horizontal
 * scroll for the beats without the words ever leaving the screen.
 */
export function Score({
  performance,
  update,
  urls,
  getTime,
  onSeek,
  duration,
  activeLineId,
  onAddImages,
  busy,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  const beatEls = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<DragState | null>(null);
  const heldUntil = useRef(0);

  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [overRow, setOverRow] = useState<string | null>(null);

  const { tempo } = performance;
  const column = ZOOMS[zoom] * Math.max(1, tempo.beatsPerBar) * COLUMN_BARS;
  /** Pixels a beat gets in one row: the shared column split between them. */
  const density = (span: number) =>
    Math.max(MIN_PX_PER_BEAT, column / Math.max(1, span));
  const rows = useMemo(
    () => phrases(performance, duration),
    [performance, duration],
  );
  const chosen = performance.images.find((i) => i.id === selected) ?? null;
  const activeRow = rows.findIndex((r) => r.line?.id === activeLineId);

  // `rows` is rebuilt on every edit, so effects that only *read* it reach it
  // through a ref. Depending on it directly would restart the animation loop
  // below — and re-issue the follow — on every keystroke.
  const latestRows = useRef(rows);
  latestRows.current = rows;
  /** Set when a pointer drag actually moved something, to swallow its click. */
  const dragged = useRef(false);

  // ------------------------------------------------------------- playhead

  // Moved by writing to one element's style inside an animation frame. The
  // alternative — re-rendering the score at 60Hz — is the only thing here
  // heavy enough to feel slow.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const marker = playhead.current;
      if (marker) {
        const beat = beatAt(tempo, getTime());
        const row = latestRows.current.find(
          (r) => beat >= r.startBeat && beat < r.endBeat,
        );
        const el = row ? rowEls.current.get(row.id) : null;
        const cell = row ? beatEls.current.get(row.id) : null;
        if (row && el && cell) {
          // Taken from the rendered cell rather than recomputed: rows differ
          // in how many pixels a beat gets, and this cannot disagree.
          const px =
            cell.clientWidth / Math.max(1, row.endBeat - row.startBeat);
          const x = cell.offsetLeft + (beat - row.startBeat) * px;
          marker.style.transform = `translate(${x}px, ${el.offsetTop}px)`;
          marker.style.height = `${el.offsetHeight}px`;
          marker.style.opacity = "1";
        } else {
          marker.style.opacity = "0";
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // No zoom dependency: the width it changes is read from the DOM above.
  }, [getTime, tempo]);

  // ----------------------------------------------------------- following

  useEffect(() => {
    const container = box.current;
    if (!container || activeRow < 0) return;
    if (Date.now() < heldUntil.current) return;
    // Typing in the panel is its own claim on the view. Only a text field
    // counts: browsers focus a button when you click it, so testing for any
    // focus at all would stall the follow the first time you used one.
    const focused = document.activeElement;
    if (focused?.tagName === "INPUT" && container.contains(focused)) return;

    // The phrase being sung sits second, with the one before it at the top:
    // a line of context behind, the rest of the verse ahead.
    const anchor = latestRows.current[Math.max(0, activeRow - 1)];
    const el = rowEls.current.get(anchor.id);
    if (!el) return;

    const limit = container.scrollHeight - container.clientHeight;
    const top = Math.max(0, Math.min(limit, el.offsetTop));
    const distance = Math.abs(top - container.scrollTop);
    if (distance < 1) return;
    container.scrollTo({
      top,
      // A seek can move the cursor by a whole song, and gliding that far
      // takes longer than the gap between two lines.
      behavior: distance > container.clientHeight ? "auto" : "smooth",
    });
  }, [activeRow]);

  function hold() {
    heldUntil.current = Date.now() + HOLD_MS;
  }

  // -------------------------------------------------------------- editing

  function setDisplay(id: string, display: string) {
    update((p) => ({
      ...p,
      lines: p.lines.map((l) => (l.id === id ? { ...l, display } : l)),
    }));
  }

  // ---------------------------------------------------------------- beats

  /**
   * The beat under a point, found by which row the pointer is over. Going
   * through the rows rather than through one shared x axis is what lets a
   * drag carry a photo from one phrase into another.
   */
  function beatFromPoint(clientX: number, clientY: number): number | null {
    for (const phrase of rows) {
      const el = rowEls.current.get(phrase.id);
      const cell = beatEls.current.get(phrase.id);
      if (!el || !cell) continue;
      const bounds = el.getBoundingClientRect();
      if (clientY < bounds.top || clientY >= bounds.bottom) continue;
      // The lyric column is sticky, so when the row is scrolled it sits on
      // top of the beats. Treat anything under it as this phrase's downbeat
      // rather than as whatever beat is hidden behind it.
      const gutter = box.current
        ? box.current.getBoundingClientRect().left + cell.offsetLeft
        : cell.getBoundingClientRect().left;
      if (clientX < gutter) return phrase.startBeat;

      const cellBox = cell.getBoundingClientRect();
      const span = Math.max(1, phrase.endBeat - phrase.startBeat);
      const offset = Math.floor(
        (clientX - cellBox.left) / (cellBox.width / span),
      );
      return Math.max(
        phrase.startBeat,
        Math.min(phrase.endBeat - 1, phrase.startBeat + offset),
      );
    }
    return null;
  }

  function rowFromPoint(clientY: number): Phrase | null {
    for (const phrase of rows) {
      const el = rowEls.current.get(phrase.id);
      if (!el) continue;
      const bounds = el.getBoundingClientRect();
      if (clientY >= bounds.top && clientY < bounds.bottom) return phrase;
    }
    return null;
  }

  /** 0 hands the row's length back to the line timings. */
  function setSpan(id: string, bars: number) {
    update((p) => ({
      ...p,
      lines: p.lines.map((l) =>
        l.id === id ? { ...l, span: Math.max(0, bars) } : l,
      ),
    }));
  }

  function patch(id: string, fields: Partial<TimelineImage>) {
    update((p) => ({
      ...p,
      images: p.images.map((i) => (i.id === id ? { ...i, ...fields } : i)),
    }));
  }

  function onPointerDown(
    e: PointerEvent,
    image: TimelineImage,
    mode: DragMode,
  ) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const at = beatFromPoint(e.clientX, e.clientY);
    dragged.current = false;
    drag.current = {
      id: image.id,
      mode,
      grab: at === null ? 0 : at - image.beat,
    };
    setSelected(image.id);
    hold();
  }

  function onPointerMove(e: PointerEvent) {
    const state = drag.current;
    if (!state) return;
    const at = beatFromPoint(e.clientX, e.clientY);
    if (at === null) return;
    const current = performance.images.find((i) => i.id === state.id);
    if (!current) return;

    if (state.mode === "move") {
      // Positioned from the pointer rather than by a delta, so the drag
      // follows across a row break instead of only sideways.
      const beat = Math.max(0, at - state.grab);
      if (beat !== current.beat) {
        dragged.current = true;
        patch(state.id, { beat });
      }
    } else {
      const beats = Math.max(1, at - current.beat + 1);
      if (beats !== current.beats) {
        dragged.current = true;
        patch(state.id, { beats });
      }
    }
  }

  function onPointerUp() {
    // No releasePointerCapture: it was taken on the segment, not here, and
    // releasing one an element never held throws. It is dropped implicitly.
    drag.current = null;
  }

  return (
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <h2 style="margin:0">Score</h2>
        <span class="grow" />
        {busy && <span class="muted">{busy}</span>}
        <label class={"pick sm" + (busy ? " off" : "")}>
          + Photos at playhead
          <input
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            disabled={busy !== ""}
            onChange={(e) => {
              const input = e.currentTarget;
              const files = Array.from(input.files ?? []);
              input.value = "";
              if (files.length) {
                onAddImages(
                  files,
                  Math.max(0, Math.floor(beatAt(tempo, getTime()))),
                );
              }
            }}
          />
        </label>
        <button
          class="sm"
          disabled={zoom === 0}
          title="Narrower beats"
          onClick={() => setZoom((z) => Math.max(0, z - 1))}
        >
          −
        </button>
        <button
          class="sm"
          disabled={zoom === ZOOMS.length - 1}
          title="Wider beats"
          onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
        >
          +
        </button>
      </div>

      <div
        class="score"
        ref={box}
        onWheel={hold}
        onPointerDown={() => {
          dragged.current = false;
          hold();
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => {
          e.preventDefault();
          setOverRow(rowFromPoint(e.clientY)?.id ?? null);
        }}
        onDragLeave={() => setOverRow(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOverRow(null);
          const files = imageFilesFrom(e.dataTransfer);
          const beat = beatFromPoint(e.clientX, e.clientY);
          if (files.length && beat !== null) onAddImages(files, beat);
        }}
      >
        {rows.map((phrase, i) => (
          <ScoreRow
            key={phrase.id}
            phrase={phrase}
            performance={performance}
            pxPerBeat={density(phrase.endBeat - phrase.startBeat)}
            urls={urls}
            active={i === activeRow}
            over={phrase.id === overRow}
            selected={selected}
            editing={editing === phrase.line?.id}
            registerRow={(el) => {
              if (el) rowEls.current.set(phrase.id, el);
              else rowEls.current.delete(phrase.id);
            }}
            registerBeats={(el) => {
              if (el) beatEls.current.set(phrase.id, el);
              else beatEls.current.delete(phrase.id);
            }}
            onEdit={() => phrase.line && setEditing(phrase.line.id)}
            onEditDone={() => setEditing(null)}
            onDisplay={setDisplay}
            onSeek={onSeek}
            onSeekBeat={(beat) => {
              // A drag that finished over the lane would otherwise land as a
              // click here and throw the playhead across the song.
              if (dragged.current) return;
              onSeek(beatTime(tempo, beat));
            }}
            onGrab={onPointerDown}
            onBars={setSpan}
          />
        ))}
        <div class="score-playhead" ref={playhead} />
      </div>

      {chosen && (
        <div class="row" style="margin-top:10px">
          <span class="muted grow">
            <strong>{chosen.filename}</strong> · beat {chosen.beat} ·{" "}
            {formatTime(beatTime(tempo, chosen.beat))}
          </span>
          <button
            class="sm"
            title="One beat shorter"
            disabled={chosen.beats <= 1}
            onClick={() => patch(chosen.id, { beats: chosen.beats - 1 })}
          >
            −
          </button>
          <span class="muted num">{chosen.beats} beats</span>
          <button
            class="sm"
            title="One beat longer"
            onClick={() => patch(chosen.id, { beats: chosen.beats + 1 })}
          >
            +
          </button>
          <button
            class="sm"
            title="Start this photo at the playhead"
            onClick={() =>
              patch(chosen.id, {
                beat: Math.max(0, Math.floor(beatAt(tempo, getTime()))),
              })
            }
          >
            To playhead
          </button>
          <button
            class="sm danger"
            onClick={() => {
              // The object stays in the bucket, as backing tracks do: it is
              // content-addressed and older versions still point at it.
              update((p) => ({
                ...p,
                images: p.images.filter((i) => i.id !== chosen.id),
              }));
              setSelected(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  phrase: Phrase;
  performance: Performance;
  pxPerBeat: number;
  urls: Map<string, string>;
  active: boolean;
  over: boolean;
  selected: string | null;
  editing: boolean;
  registerRow: (el: HTMLDivElement | null) => void;
  registerBeats: (el: HTMLDivElement | null) => void;
  onEdit: () => void;
  onEditDone: () => void;
  onDisplay: (id: string, display: string) => void;
  onSeek: (seconds: number) => void;
  onSeekBeat: (beat: number) => void;
  onGrab: (e: PointerEvent, image: TimelineImage, mode: DragMode) => void;
  /** Set this line's row length in bars; 0 goes back to the timed length. */
  onBars: (id: string, bars: number) => void;
}

function ScoreRow({
  phrase,
  performance,
  pxPerBeat,
  urls,
  active,
  over,
  selected,
  editing,
  registerRow,
  registerBeats,
  onEdit,
  onEditDone,
  onDisplay,
  onSeek,
  onSeekBeat,
  onGrab,
  onBars,
}: RowProps) {
  const { tempo } = performance;
  const span = phrase.endBeat - phrase.startBeat;
  const width = span * pxPerBeat;
  const perBar = Math.max(1, tempo.beatsPerBar);
  // Bar lines have to keep counting across the row break, so the pattern is
  // shifted by where this phrase happens to fall inside its bar.
  const phase = ((phrase.startBeat % perBar) + perBar) % perBar;
  // Rows begin on a bar line, but the line itself was timed off the recording
  // and can sit a little either side of one, so its chords are drawn from
  // where the line actually falls rather than from the row's own edge.
  const lineOffset = phrase.line
    ? beatAt(tempo, phrase.line.time) - phrase.startBeat
    : 0;
  const grid =
    `background-image:` +
    `repeating-linear-gradient(to right,#2a3140 0 1px,transparent 1px ${perBar * pxPerBeat}px),` +
    `repeating-linear-gradient(to right,#1d222c 0 1px,transparent 1px ${pxPerBeat}px);` +
    `background-position:${-phase * pxPerBeat}px 0,0 0;`;

  return (
    <div
      class={"score-row" + (active ? " active" : "") + (over ? " over" : "")}
      ref={registerRow}
    >
      <div class="score-lyric" onDblClick={onEdit}>
        <button
          class="sl-time"
          title="Jump here"
          onClick={() =>
            onSeek(
              phrase.line
                ? phrase.line.time
                : beatTime(tempo, phrase.startBeat),
            )
          }
        >
          {formatTime(
            phrase.line ? phrase.line.time : beatTime(tempo, phrase.startBeat),
          )}
        </button>

        {phrase.line ? (
          <div class="sl-text">
            {editing ? (
              <>
                <input
                  class="sl-big"
                  type="text"
                  value={phrase.line.display}
                  placeholder={phrase.line.text || "(instrumental)"}
                  ref={(el) => {
                    if (el && document.activeElement !== el) el.focus();
                  }}
                  onInput={(e) =>
                    onDisplay(phrase.line!.id, e.currentTarget.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      onEditDone();
                    }
                  }}
                  onBlur={onEditDone}
                />
                <span class="sl-small">
                  {phrase.line.text || "(instrumental)"}
                </span>
              </>
            ) : (
              <>
                <span
                  class={
                    "sl-big" + (phrase.line.display.trim() ? "" : " original")
                  }
                  title="Double-click to rewrite"
                >
                  {displayText(phrase.line) || "(instrumental)"}
                </span>
                {/* Only worth a second line when it differs from the first. */}
                {phrase.line.display.trim() && (
                  <span class="sl-small">
                    {phrase.line.text || "(instrumental)"}
                  </span>
                )}
              </>
            )}
          </div>
        ) : (
          <span class="sl-big label">{phrase.label}</span>
        )}

        <BarCount phrase={phrase} onBars={onBars} />
      </div>

      <div
        class="score-beats"
        ref={registerBeats}
        style={`width:${width}px;${grid}`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeekBeat(
            phrase.startBeat + Math.floor((e.clientX - box.left) / pxPerBeat),
          );
        }}
      >
        <div class="sb-photos">
          {performance.images.map((image) => {
            const from = Math.max(phrase.startBeat, image.beat);
            const to = Math.min(phrase.endBeat, image.beat + image.beats);
            if (to <= from) return null;
            const first = from === image.beat;
            const last = to === image.beat + image.beats;
            const url = urls.get(image.key);
            return (
              <div
                key={image.id}
                class={
                  "sb-photo" +
                  (image.id === selected ? " selected" : "") +
                  (first ? " first" : "") +
                  (last ? " last" : "")
                }
                style={`left:${(from - phrase.startBeat) * pxPerBeat}px;width:${
                  (to - from) * pxPerBeat
                }px`}
                title={`${image.filename} · beat ${image.beat} · ${image.beats} beats`}
                onPointerDown={(e) => onGrab(e, image, "move")}
                onClick={(e) => e.stopPropagation()}
              >
                {url && <img src={url} alt="" draggable={false} />}
                {first && <span class="sb-name">{image.filename}</span>}
                {last && (
                  <span
                    class="sb-handle"
                    title="Drag to change how many beats it stays"
                    onPointerDown={(e) => onGrab(e, image, "resize")}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div class="sb-chords">
          {(phrase.line?.chords ?? [])
            .filter((c) => lineOffset + c.beat < span)
            .map((chord) => (
              <span
                key={chord.id}
                class="sb-chord"
                style={`left:${(lineOffset + chord.beat) * pxPerBeat}px`}
              >
                {chordSymbol(chord.root, chord.quality)}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * How many bars this row lasts, and the means to change it.
 *
 * The derived length is right most of the time and wrong in a way only the
 * ear can settle: a phrase followed by a held note reads as two bars, a line
 * tapped in a beat late reads as one. So the number is shown on every row,
 * with the count itself as the way back to the timed value — a row nudged by
 * hand stays nudged until it is handed back, and says so in its colour.
 */
function BarCount({
  phrase,
  onBars,
}: {
  phrase: Phrase;
  onBars: (id: string, bars: number) => void;
}) {
  const line = phrase.line;
  if (!line) {
    // A rest or the intro: its length is whatever the rows around it left
    // over, so there is nothing here to set.
    return (
      <span class="sl-bars">
        <span class="sl-count">{phrase.bars}</span>
      </span>
    );
  }
  const byHand = line.span > 0;

  return (
    // Nudging twice in quick succession must not read as the double-click
    // that opens the lyric editor on the column behind these buttons.
    <span class="sl-bars" onDblClick={(e) => e.stopPropagation()}>
      <button
        class="sm"
        title="One bar shorter, the rest becoming a rest"
        disabled={phrase.bars <= 1}
        onClick={() => onBars(line.id, phrase.bars - 1)}
      >
        −
      </button>
      <button
        class={"sl-count" + (byHand ? " set" : "")}
        title={
          byHand
            ? `Set by hand. Click for the timed length.`
            : "Length taken from where the next line falls"
        }
        onClick={() => byHand && onBars(line.id, 0)}
      >
        {phrase.bars}
      </button>
      <button
        class="sm"
        title={
          phrase.bars >= phrase.maxBars
            ? "The next line starts here"
            : "One bar longer"
        }
        disabled={phrase.bars >= phrase.maxBars}
        onClick={() => onBars(line.id, phrase.bars + 1)}
      >
        +
      </button>
    </span>
  );
}
