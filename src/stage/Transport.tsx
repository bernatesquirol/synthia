import { formatTime } from "../performance/types";

interface Props {
  playing: boolean;
  /** Seconds on the performance timeline, re-rendered at the clock's rate. */
  time: number;
  duration: number;
  onToggle: () => void;
  onSeek: (seconds: number) => void;
  /** Whether the picture is currently in its own window. */
  popped: boolean;
  /** Called straight from the click, so the pop-out is not blocked. */
  onPopOut: () => void;
}

/**
 * The controls, which stay on this page whatever the picture does.
 *
 * The same row serves the workshop and the published performance: whoever is
 * watching, the transport belongs where the hands are, and popping the
 * picture onto a second screen must not take the play button with it.
 */
export function Transport({
  playing,
  time,
  duration,
  onToggle,
  onSeek,
  popped,
  onPopOut,
}: Props) {
  return (
    <div class="row" style="margin-top:10px">
      <button class="primary" onClick={onToggle}>
        {playing ? "Pause" : "Play"}
      </button>
      <button onClick={() => onSeek(time - 5)}>−5s</button>
      <button onClick={() => onSeek(time + 5)}>+5s</button>
      <button title="Back to the start" onClick={() => onSeek(0)}>
        ⏮
      </button>
      <span class="clock">{formatTime(time)}</span>
      <span class="muted">of {formatTime(duration)}</span>
      <span class="grow" />
      <button
        title={
          popped
            ? "Close the stage window and show the picture here again"
            : "Show the picture in its own window — for a second screen"
        }
        onClick={onPopOut}
      >
        {popped ? "Bring it back" : "Pop out ⧉"}
      </button>
    </div>
  );
}
