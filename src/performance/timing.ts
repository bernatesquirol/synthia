/**
 * Repairing the timings of a lyric sheet.
 *
 * Times arrive from three places that all go wrong differently: an imported
 * .lrc can hold two lines on one timestamp, tap-syncing can double-stamp or
 * miss a line entirely, and inserting a line copies the time of the one above
 * it by construction. The result is the same in each case — two lines claiming
 * the same moment, or one that goes backwards — and the score above can only
 * show it as a row of no length.
 *
 * The operations here are deliberately small and separate. Retiming one line
 * is not the same job as dragging the rest of the song after it, and guessing
 * which was meant would be worse than offering both.
 */
import type { PerformanceLine } from "./types";

/**
 * Times this close count as the same moment. Two lyric lines are never
 * really 50ms apart; a gap that small is a double-stamp or a copied time.
 */
export const TIE_TOLERANCE = 0.05;

/** Seconds given to each tied line when there is no next time to spread to. */
const TAIL_GAP = 2;

export interface TimingProblem {
  /** The line at fault: the second of a pair, since the first reads fine. */
  index: number;
  /** `tie` shares its time with the line above; `back` sits before it. */
  kind: "tie" | "back";
}

/**
 * Lines whose time is not strictly after the line above them.
 *
 * Reported against the later line of each pair, which is the one a fix
 * should move: the earlier one is usually right.
 */
export function timingProblems(lines: PerformanceLine[]): TimingProblem[] {
  const problems: TimingProblem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].time - lines[i - 1].time;
    if (Math.abs(gap) < TIE_TOLERANCE) problems.push({ index: i, kind: "tie" });
    else if (gap < 0) problems.push({ index: i, kind: "back" });
  }
  return problems;
}

/**
 * Move `from` onwards by `delta` seconds.
 *
 * This is the fix for a verse that came in late and took the whole rest of
 * the song with it: correct the one line, then drag everything after it by
 * the same amount rather than re-tapping fifty lines.
 */
export function shiftFrom(
  lines: PerformanceLine[],
  from: number,
  delta: number,
): PerformanceLine[] {
  if (delta === 0) return lines;
  return lines.map((line, i) =>
    i >= from ? { ...line, time: Math.max(0, line.time + delta) } : line,
  );
}

/**
 * Spread runs of lines sharing a time evenly over the space they have.
 *
 * A tied run is stretched from its own time up to the next distinct one, so
 * the lines around it never move — the ties are a local mistake and fixing
 * them should not re-time the rest of the song. A run at the very end has no
 * next time to reach, so it falls back to a plain gap per line.
 */
export function spreadTies(lines: PerformanceLine[]): PerformanceLine[] {
  const out = [...lines];
  let i = 0;
  while (i < out.length) {
    let last = i;
    while (
      last + 1 < out.length &&
      Math.abs(out[last + 1].time - out[i].time) < TIE_TOLERANCE
    ) {
      last++;
    }

    if (last > i) {
      const start = out[i].time;
      const count = last - i + 1;
      const next =
        last + 1 < out.length ? out[last + 1].time : start + TAIL_GAP * count;
      const step = (next - start) / count;
      for (let k = i + 1; k <= last; k++) {
        out[k] = { ...out[k], time: start + step * (k - i) };
      }
    }
    i = last + 1;
  }
  return out;
}
