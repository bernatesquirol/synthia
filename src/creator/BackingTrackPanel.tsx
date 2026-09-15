import { useEffect, useState } from "preact/hooks";
import {
  BACKING_ACCEPT,
  formatBytes,
  prepareBackingTrack,
} from "../performance/backing";
import type { RemoteStore } from "../performance/remote";
import {
  BACKING_LENGTH_TOLERANCE,
  formatTime,
  type BackingTrack,
  type Performance,
} from "../performance/types";
import { cacheAsset } from "../performance/assets";
import { beginUpload } from "../performance/uploads";
import type { BackingHandle } from "../performance/useBackingTrack";

interface Props {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  remote: RemoteStore;
  backing: BackingHandle;
}

/**
 * Attach one audio file that runs the length of the video and plays over it.
 *
 * Uploading happens the moment a file is picked rather than at publish time,
 * so the document only ever names audio that is already in the bucket and a
 * refresh mid-session loses nothing. The cost is an orphaned object when a
 * track is picked and then dropped, which is the same bargain the immutable
 * snapshots already make.
 */
export function BackingTrackPanel({
  performance,
  update,
  remote,
  backing,
}: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const track = performance.backingTrack;
  /**
   * Collapsed when a track is already attached: the mixer is a thing you set
   * once and then want out of the way of the lyrics. Computed at mount only,
   * so attaching one does not fold the panel while you are using it.
   */
  const [open, setOpen] = useState(() => performance.backingTrack === null);

  function setTrack(fn: (t: BackingTrack) => BackingTrack) {
    update((p) => ({
      ...p,
      backingTrack: p.backingTrack ? fn(p.backingTrack) : p.backingTrack,
    }));
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setError("");
    // Registered globally as well as shown here: the toolbar holds Publish
    // back until the bytes have landed, since the document does not name the
    // track until this finishes.
    const upload = beginUpload("Backing track");
    function stage(text: string) {
      setBusy(text);
      upload.label(`Backing track · ${text}`);
    }

    try {
      stage("Reading…");
      const prepared = await prepareBackingTrack(file);
      stage(`Uploading ${formatBytes(prepared.track.bytes)}…`);
      await remote.putAsset(performance.id, prepared.track.key, prepared.blob);
      // Seed the cache so playback starts without fetching back what we just
      // sent, and carry over the mix from a track being replaced.
      cacheAsset(performance.id, prepared.track.key, prepared.blob);
      update((p) => ({
        ...p,
        backingTrack: p.backingTrack
          ? {
              ...prepared.track,
              offset: p.backingTrack.offset,
              gain: p.backingTrack.gain,
              muteVideo: p.backingTrack.muteVideo,
            }
          : prepared.track,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
      upload.done();
    }
  }

  return (
    <details
      class="card fold"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <h2>Backing track</h2>
        {/* Enough of the state to make opening it unnecessary. */}
        <span class="muted grow">
          {busy ||
            (track
              ? `${track.filename} · ${formatTime(track.duration)}`
              : "none attached")}
        </span>
        {backing.status === "error" && <span class="error">will not play</span>}
      </summary>

      {!remote.enabled && (
        <p class="muted" style="margin-top:0">
          Audio uploads need a presign endpoint — a file this size will not fit
          in localStorage. Set <code>persistence.presignEndpoint</code> to
          attach one.
        </p>
      )}

      {track === null ? (
        <>
          <p class="muted" style="margin-top:0">
            One audio file covering the whole video — an instrumental, a stem
            mix, a re-recording. This is the finished piece's audio, and in step
            2 it is the clock everything else runs on, so it has to start where
            the video starts and run the same length.
          </p>
          <PickButton
            onPick={pick}
            disabled={!remote.enabled || busy !== ""}
            label={busy || "Choose audio file"}
          />
        </>
      ) : (
        <>
          <div class="row">
            <span class="grow">
              <strong>{track.filename}</strong>
            </span>
            <span class="muted">{formatBytes(track.bytes)}</span>
            <span class="muted">{formatTime(track.duration)}</span>
            <PickButton
              onPick={pick}
              disabled={!remote.enabled || busy !== ""}
              label={busy || "Replace"}
              small
            />
            <button
              class="sm danger"
              disabled={busy !== ""}
              onClick={() => {
                // The object stays in the bucket: published versions still
                // point at it, and it is content-addressed either way.
                update((p) => ({ ...p, backingTrack: null }));
                setError("");
              }}
            >
              Remove
            </button>
          </div>

          <LengthCheck
            trackDuration={track.duration}
            videoDuration={performance.duration}
          />

          <div class="mixer">
            {/* The piece's own mix. What *you* hear while working is the
                pair of switches under the player, which start from this and
                then go their own way. */}
            <label class="mix-row">
              <span>Mute the video</span>
              <span class="grow">
                <input
                  type="checkbox"
                  checked={track.muteVideo}
                  onChange={(e) => {
                    const muteVideo = e.currentTarget.checked;
                    setTrack((t) => ({ ...t, muteVideo }));
                  }}
                />{" "}
                <span class="muted">
                  {track.muteVideo
                    ? "in the finished piece, only this track is heard"
                    : "in the finished piece, both are heard"}
                </span>
              </span>
            </label>

            <label class="mix-row">
              <span>Level</span>
              <span class="grow">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={String(Math.round(track.gain * 100))}
                  onInput={(e) => {
                    const gain = Number(e.currentTarget.value) / 100;
                    setTrack((t) => ({ ...t, gain }));
                  }}
                />
              </span>
              <span class="muted num">{Math.round(track.gain * 100)}%</span>
            </label>

            <OffsetRow
              offset={track.offset}
              onOffset={(offset) => setTrack((t) => ({ ...t, offset }))}
            />

            <div class="mix-row">
              <span>Sync</span>
              <span class="grow">
                <SyncStatus backing={backing} />
              </span>
            </div>
          </div>
        </>
      )}

      {error && <p class="error">{error}</p>}
      {backing.status === "error" && <p class="error">{backing.error}</p>}
    </details>
  );
}

/**
 * A file input styled as a button. The native control cannot be restyled and
 * reads badly next to the rest of the row, so it is hidden behind a label.
 */
function PickButton({
  onPick,
  disabled,
  label,
  small,
}: {
  onPick: (e: Event) => void;
  disabled: boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <label
      class={"pick" + (small ? " sm" : " primary") + (disabled ? " off" : "")}
    >
      {label}
      <input
        type="file"
        accept={BACKING_ACCEPT}
        disabled={disabled}
        onChange={onPick}
      />
    </label>
  );
}

/**
 * The track is meant to run the length of the video, so say plainly when it
 * does not: a file that is a few seconds short is usually the wrong export,
 * and finding that out here beats finding it out mid-performance.
 */
function LengthCheck({
  trackDuration,
  videoDuration,
}: {
  trackDuration: number;
  videoDuration: number;
}) {
  if (videoDuration <= 0) {
    return (
      <p class="muted" style="margin-bottom:0">
        Play the video for a moment to read its length, and this will compare
        the two.
      </p>
    );
  }
  const difference = trackDuration - videoDuration;
  if (Math.abs(difference) <= BACKING_LENGTH_TOLERANCE) {
    return (
      <p class="ok" style="margin-bottom:0">
        Matches the video ({formatTime(videoDuration)}).
      </p>
    );
  }
  return (
    <p class="warn" style="margin-bottom:0">
      {formatTime(Math.abs(difference))} {difference > 0 ? "longer" : "shorter"}{" "}
      than the video ({formatTime(videoDuration)}). It will still play, but it
      will run out of step by the end unless that gap is silence.
    </p>
  );
}

const NUDGES = [-100, -10, 10, 100];

function OffsetRow({
  offset,
  onOffset,
}: {
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const milliseconds = Math.round(offset * 1000);
  return (
    <label class="mix-row">
      <span>Offset</span>
      <span class="grow row">
        {NUDGES.map((step) => (
          <button
            key={step}
            class="sm"
            onClick={() => onOffset((milliseconds + step) / 1000)}
          >
            {step > 0 ? `+${step}` : step}
          </button>
        ))}
        <input
          type="number"
          step="10"
          class="ms"
          value={String(milliseconds)}
          onInput={(e) => {
            const value = Number(e.currentTarget.value);
            if (Number.isFinite(value)) onOffset(value / 1000);
          }}
        />
        <span class="muted">ms later than the video</span>
        {milliseconds !== 0 && (
          <button class="sm" onClick={() => onOffset(0)}>
            Reset
          </button>
        )}
      </span>
    </label>
  );
}

/**
 * Live view of how far the track has slipped. Polled rather than rendered
 * from state: the value changes every frame and nothing else on the page
 * needs to re-render for it.
 */
function SyncStatus({ backing }: { backing: BackingHandle }) {
  const [drift, setDrift] = useState(0);

  useEffect(() => {
    if (backing.status !== "ready") return;
    const timer = window.setInterval(() => setDrift(backing.drift()), 200);
    return () => window.clearInterval(timer);
  }, [backing]);

  if (backing.status === "loading")
    return <span class="muted">Loading audio…</span>;
  if (backing.status === "error")
    return <span class="error">Not playing — see below.</span>;
  if (backing.status !== "ready") return <span class="muted">—</span>;

  const milliseconds = Math.round(drift * 1000);
  return (
    <span class={Math.abs(milliseconds) > 60 ? "warn" : "ok"}>
      {milliseconds === 0
        ? "locked"
        : `${milliseconds > 0 ? "+" : ""}${milliseconds} ms`}
      <span class="muted">
        {" "}
        · corrected automatically; use Offset for a constant lead or lag
      </span>
    </span>
  );
}
