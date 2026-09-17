import {
  beatAt,
  displayText,
  imageAt,
  lineIndexAt,
  type Performance,
  type PerformanceLine,
} from "../performance/types";

interface Props {
  performance: Performance;
  /** Seconds on the performance timeline. Re-rendered at the clock's rate. */
  time: number;
  /** Blob URLs by image key, from `useAssetUrls`. */
  urls: Map<string, string>;
  /** Lines pre-sorted by the caller, which already needs them that way. */
  lines: PerformanceLine[];
}

/**
 * What the finished piece looks like at one moment: the photo covering this
 * beat, with the rewritten lyric across it.
 *
 * A photo keeps whatever shape it was taken in, so by default the whole of
 * it is shown and the black frame fills whatever is left over; a photo asked
 * to crop fills the frame instead and loses its edges.
 *
 * A beat with no photo shows black rather than holding the last one, and
 * nothing but black: the lyric still sings over it, but no notice about the
 * gap, because this frame is the piece and not a report on it. Photos carry
 * an explicit length in beats, and quietly extending one past the length you
 * gave it would make that number a lie; better that a gap reads as a gap
 * here, where you can fix it, than at performance time.
 */
export function PreviewStage({ performance, time, urls, lines }: Props) {
  const beat = Math.floor(beatAt(performance.tempo, time));
  const image = imageAt(performance.images, beat);
  const url = image ? urls.get(image.key) : undefined;

  const index = lineIndexAt(lines, time);
  const line = index >= 0 ? lines[index] : null;
  const lyric = line ? displayText(line) : "";

  return (
    <div class="stage">
      {url && (
        <img
          class={"stage-photo" + (image?.fit === "crop" ? " crop" : "")}
          src={url}
          alt={image?.filename ?? ""}
        />
      )}
      {lyric && (
        <div class="stage-lyric">
          <span class={line && !line.display.trim() ? "untranslated" : ""}>
            {lyric}
          </span>
        </div>
      )}
    </div>
  );
}
