import { useState } from "preact/hooks";
import { chordSymbol, QUALITIES } from "../music/chords";
import { PC_NAMES } from "../music/layout";
import {
  formatTime,
  newId,
  parseTime,
  tickTime,
  type ChordChange,
  type PerformanceLine,
  type Tempo,
} from "../performance/types";

interface Props {
  line: PerformanceLine;
  active: boolean;
  cursor: boolean;
  tempo: Tempo;
  /** Reads the player position live; see the memoised list in Editor. */
  getNow: () => number;
  onChange: (line: PerformanceLine) => void;
  onDelete: () => void;
  onInsertAfter: () => void;
  onSeek: (time: number) => void;
}

export function LineRow({
  line,
  active,
  cursor,
  tempo,
  getNow,
  onChange,
  onDelete,
  onInsertAfter,
  onSeek,
}: Props) {
  /** Which chord this row is editing, if any. */
  const [selected, setSelected] = useState<string | null>(null);

  const byBeat = new Map<number, ChordChange>();
  for (const chord of line.chords) byBeat.set(chord.beat, chord);
  const editing = line.chords.find((c) => c.id === selected) ?? null;

  function setChords(chords: ChordChange[]) {
    onChange({ ...line, chords });
  }

  function toggleTick(beat: number) {
    const existing = byBeat.get(beat);
    if (existing) {
      setSelected(existing.id === selected ? null : existing.id);
      return;
    }
    // New chords inherit the nearest chord to their left, which is usually
    // what you want when laying out a progression across the bar.
    const previous = [...line.chords]
      .filter((c) => c.beat < beat)
      .sort((a, b) => b.beat - a.beat)[0];
    const chord: ChordChange = {
      id: newId("chord"),
      beat,
      root: previous?.root ?? "C",
      quality: previous?.quality ?? "maj",
    };
    setChords([...line.chords, chord].sort((a, b) => a.beat - b.beat));
    setSelected(chord.id);
  }

  function patchSelected(patch: Partial<ChordChange>) {
    if (!editing) return;
    setChords(
      line.chords.map((c) => (c.id === editing.id ? { ...c, ...patch } : c)),
    );
  }

  function setBars(bars: number) {
    const next = Math.max(1, bars);
    // Shrinking would otherwise orphan chords past the end of the grid.
    const limit = next * Math.max(1, tempo.beatsPerBar);
    onChange({
      ...line,
      bars: next,
      chords: line.chords.filter((c) => c.beat < limit),
    });
  }

  const classes = ["line", active ? "active" : "", cursor ? "cursor" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div class={classes}>
      <input
        class="time"
        type="text"
        value={formatTime(line.time)}
        title="Downbeat of this line. Type a time, or use the buttons."
        onChange={(e) => {
          const seconds = parseTime(e.currentTarget.value);
          if (Number.isNaN(seconds))
            e.currentTarget.value = formatTime(line.time);
          else onChange({ ...line, time: seconds });
        }}
      />

      <div class="tools">
        <button
          class="sm"
          title="Stamp the player's current time onto this line"
          onClick={() => onChange({ ...line, time: getNow() })}
        >
          ⏱
        </button>
        <button
          class="sm"
          title="Jump the video here"
          onClick={() => onSeek(line.time)}
        >
          ▶
        </button>
      </div>

      <input
        class="text grow"
        type="text"
        value={line.text}
        placeholder="(instrumental)"
        onInput={(e) => onChange({ ...line, text: e.currentTarget.value })}
      />

      <div class="tools">
        <button
          class="sm"
          title="Remove a measure from this phrase"
          disabled={line.bars <= 1}
          onClick={() => setBars(line.bars - 1)}
        >
          −
        </button>
        <span class="bars" title="Measures in this phrase">
          {line.bars}
        </span>
        <button
          class="sm"
          title="Add a measure — for a long phrase or extra time"
          onClick={() => setBars(line.bars + 1)}
        >
          +
        </button>
        <button class="sm" title="Insert a line below" onClick={onInsertAfter}>
          ↵
        </button>
        <button class="sm danger" title="Delete this line" onClick={onDelete}>
          ×
        </button>
      </div>

      <div class="beats">
        {Array.from({ length: line.bars }, (_, bar) => (
          <div class="bar" key={bar}>
            {Array.from({ length: tempo.beatsPerBar }, (_, beatInBar) => {
              const beat = bar * tempo.beatsPerBar + beatInBar;
              const chord = byBeat.get(beat);
              const cls = [
                "tick",
                beatInBar === 0 ? "downbeat" : "",
                chord ? "filled" : "",
                chord && chord.id === selected ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  class={cls}
                  key={beat}
                  title={`${chord ? "Edit chord" : "Place a chord"} · bar ${
                    bar + 1
                  } beat ${beatInBar + 1} · ${formatTime(
                    tickTime(line, beat, tempo),
                  )}`}
                  onClick={() => toggleTick(beat)}
                >
                  {chord ? chordSymbol(chord.root, chord.quality) : ""}
                </button>
              );
            })}
          </div>
        ))}
        {line.chords.length > 0 && (
          <button
            class="sm"
            title="Clear every chord on this line"
            onClick={() => {
              setChords([]);
              setSelected(null);
            }}
          >
            clear
          </button>
        )}
      </div>

      {editing && (
        <div class="chord-editor">
          <span class="muted">
            beat {editing.beat + 1} ·{" "}
            {formatTime(tickTime(line, editing.beat, tempo))}
          </span>
          <select
            value={editing.root}
            onChange={(e) => patchSelected({ root: e.currentTarget.value })}
          >
            {PC_NAMES.map((pc) => (
              <option key={pc} value={pc}>
                {pc}
              </option>
            ))}
          </select>
          <select
            value={editing.quality}
            onChange={(e) => patchSelected({ quality: e.currentTarget.value })}
          >
            {QUALITIES.map((q) => (
              <option key={q.label} value={q.label}>
                {q.label}
              </option>
            ))}
          </select>
          <button
            class="sm danger"
            onClick={() => {
              setChords(line.chords.filter((c) => c.id !== editing.id));
              setSelected(null);
            }}
          >
            Remove
          </button>
          <button class="sm" onClick={() => setSelected(null)}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
