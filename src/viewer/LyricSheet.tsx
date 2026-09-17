import { link } from "../router";
import {
  displayText,
  sortedLines,
  type Performance,
} from "../performance/types";
import { siblingLink, usePerformanceDoc } from "./usePerformanceDoc";

/**
 * The words, on paper terms: no clock, no audio, nothing to press.
 *
 * This is the link you send to a phone. It carries no sync deliberately —
 * following a highlight on a small screen means holding the phone up and
 * watching it, when what you want is to glance down, find your place and
 * look up again. So the whole song is here at once, large enough to read at
 * arm's length, and it stays where you left it.
 *
 * Where a line was rewritten the original is kept underneath it, small: it is
 * what the recording is singing, and the quickest way to find your place in a
 * song you half know.
 */
export function LyricSheet() {
  const doc = usePerformanceDoc();

  if (doc.phase !== "ready") {
    return (
      <div class="sheet">
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
    );
  }

  return <Sheet performance={doc.performance} />;
}

function Sheet({ performance }: { performance: Performance }) {
  const lines = sortedLines(performance);

  return (
    <div class="sheet">
      <h1>{performance.title || "Untitled"}</h1>
      {performance.artist && <p class="sheet-artist">{performance.artist}</p>}

      {lines.length === 0 ? (
        <p class="muted">This version has no lyrics yet.</p>
      ) : (
        <ol class="sheet-lines">
          {lines.map((line) => {
            const rewritten = line.display.trim();
            return (
              <li key={line.id}>
                <span class={rewritten ? "sheet-line" : "sheet-line original"}>
                  {displayText(line) || "·"}
                </span>
                {/* Only worth showing when it differs from the line above it. */}
                {rewritten && line.text.trim() && (
                  <span class="sheet-source">{line.text}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p class="sheet-foot">
        <a href={link(siblingLink("/performance"))}>Play the performance</a>
      </p>
    </div>
  );
}
