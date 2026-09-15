import { useEffect, useRef } from "preact/hooks";
import {
  formatTime,
  parseTime,
  type PerformanceLine,
} from "../performance/types";

interface Props {
  line: PerformanceLine;
  active: boolean;
  cursor: boolean;
  /** Set when this line's time collides with the line above it. */
  problem?: "tie" | "back";
  /** Reads the player position live; see the memoised list in SourcePanel. */
  getNow: () => number;
  onChange: (line: PerformanceLine) => void;
  onDelete: () => void;
  onInsertAfter: () => void;
  onSeek: (time: number) => void;
}

/**
 * One original lyric line and its time.
 *
 * This used to carry a per-line beat grid and chord picker. Both moved to the
 * continuous timeline in step 2, where photos and chords are lanes over one
 * shared grid; the chord *data* is untouched and still drawn there. What is
 * left here is what step 1 is actually for: the words the source sings, and
 * the moment it sings them.
 */
export function LineRow({
  line,
  active,
  cursor,
  problem,
  getNow,
  onChange,
  onDelete,
  onInsertAfter,
  onSeek,
}: Props) {
  const follow = useRef<HTMLDivElement>(null);
  // The list scrolls now, so the line being sung has to bring itself into
  // view or tap-syncing goes blind. `nearest` is a no-op while it is already
  // visible, which keeps it from fighting a hand scroll every line.
  useEffect(() => {
    if (active) follow.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const classes = ["line", active ? "active" : "", cursor ? "cursor" : ""]
    .filter(Boolean)
    .join(" ");
  const fault =
    problem === "tie"
      ? "Same time as the line above, so one of them gets no room in the score."
      : problem === "back"
        ? "Earlier than the line above it."
        : "";

  return (
    <div class={classes} ref={follow}>
      <input
        class={"time" + (problem ? " bad" : "")}
        type="text"
        value={formatTime(line.time)}
        title={
          fault || "When this line is sung. Type a time, or use the buttons."
        }
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
        {line.chords.length > 0 && (
          <span class="muted" title="Chords on this line, edited in step 2">
            {line.chords.length}♪
          </span>
        )}
        <button class="sm" title="Insert a line below" onClick={onInsertAfter}>
          ↵
        </button>
        <button class="sm danger" title="Delete this line" onClick={onDelete}>
          ×
        </button>
      </div>
    </div>
  );
}
