import {
  beatAt,
  beatTime,
  formatTime,
  type Performance,
  type TimelineImage,
} from "../performance/types";

interface Props {
  image: TimelineImage;
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  /** Live clock read, for placing the photo at the playhead. */
  getNow: () => number;
  /** Take the playhead to this photo, so the stage above shows it. */
  onShow: () => void;
  onClose: () => void;
}

/**
 * The selected photo, and everything you can do to it.
 *
 * It sits beside the stage rather than under the score because that is where
 * you are looking, and the score is tall enough that controls placed after it
 * were off the bottom of the window at the moment a photo was selected.
 *
 * The stage only ever shows the photo under the playhead, so Jump to it is
 * how a photo being framed is brought onto the stage to be looked at.
 *
 * Closing only lets the selection go — the photo stays where it is; Remove is
 * the button that takes it off the timeline.
 */
export function PhotoPanel({
  image,
  performance,
  update,
  getNow,
  onShow,
  onClose,
}: Props) {
  const { tempo } = performance;

  function patch(fields: Partial<TimelineImage>) {
    update((p) => ({
      ...p,
      images: p.images.map((i) =>
        i.id === image.id ? { ...i, ...fields } : i,
      ),
    }));
  }

  return (
    <div class="card photo-panel">
      <div class="row">
        <h2 style="margin:0" class="grow">
          Photo
        </h2>
        <button
          class="sm pp-close"
          title="Deselect the photo and close this panel (Escape)"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <p class="pp-name" title={image.filename}>
        {image.filename}
      </p>

      <p class="muted" style="margin:0 0 10px">
        beat {image.beat} · {formatTime(beatTime(tempo, image.beat))} ·{" "}
        <button class="sm" title="Show it on the stage above" onClick={onShow}>
          Jump to it
        </button>
      </p>

      <div class="row">
        <button
          class="sm"
          title="One beat shorter"
          disabled={image.beats <= 1}
          onClick={() => patch({ beats: image.beats - 1 })}
        >
          −
        </button>
        <span class="muted num">{image.beats} beats</span>
        <button
          class="sm"
          title="One beat longer"
          onClick={() => patch({ beats: image.beats + 1 })}
        >
          +
        </button>
        <span class="grow" />
        <button
          class="sm"
          title="Start this photo at the playhead"
          onClick={() =>
            patch({ beat: Math.max(0, Math.floor(beatAt(tempo, getNow()))) })
          }
        >
          To playhead
        </button>
      </div>

      <div class="row" style="margin-top:10px">
        <span class="muted">Frame</span>
        <button
          class={"sm toggle" + (image.fit !== "crop" ? " on" : "")}
          title="Show the whole photo, framed in black where it does not fill"
          onClick={() => patch({ fit: "fit" })}
        >
          Fit
        </button>
        <button
          class={"sm toggle" + (image.fit === "crop" ? " on" : "")}
          title="Fill the frame, losing the edges of the photo"
          onClick={() => patch({ fit: "crop" })}
        >
          Crop
        </button>
        <span class="grow" />
        <button
          class="sm danger"
          title="Take this photo off the timeline"
          onClick={() => {
            // The object stays in the bucket, as backing tracks do: it is
            // content-addressed and older versions still point at it.
            update((p) => ({
              ...p,
              images: p.images.filter((i) => i.id !== image.id),
            }));
            onClose();
          }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
