import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { cacheAsset, loadAsset, useAssetUrls } from "../performance/assets";
import { useWorkshopClock } from "../performance/clock";
import { placeImage, prepareImage } from "../performance/images";
import type { RemoteStore } from "../performance/remote";
import {
  beatAt,
  beatTime,
  formatTime,
  lineIndexAt,
  secondsPerBeat,
  sortedLines,
  type Performance,
} from "../performance/types";
import {
  fitTempoToLines,
  guessTempoFromAudio,
  WEAK_FIT,
  type TempoGuess,
} from "../performance/tempofit";
import { beginUpload } from "../performance/uploads";
import { PhotoPanel } from "./PhotoPanel";
import { PreviewStage } from "../stage/PreviewStage";
import { StageSlot, useStageWindow } from "../stage/StageWindow";
import { Transport } from "../stage/Transport";
import { Score } from "./Score";

interface Props {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  remote: RemoteStore;
}

/**
 * Step 2. Everything here reads from one clock — the backing track — and the
 * YouTube video is gone: what you are looking at is the piece itself, not the
 * source it was built from.
 */
export function Workshop({ performance, update, remote }: Props) {
  const clock = useWorkshopClock(
    performance.id,
    performance.backingTrack,
    performance.duration,
    remote,
  );

  const [now, setNow] = useState(0);
  /** Live clock, for handlers that must not go stale between renders. */
  const nowRef = useRef(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  /**
   * The photo whose controls are open, held here rather than in the score:
   * the panel belongs beside the stage, where its framing can be judged
   * against the picture it will appear in.
   */
  const [selected, setSelected] = useState<string | null>(null);
  /** Whether the picture is on this page or in its own window. */
  const popout = useStageWindow();

  // Stable: the timeline keys an animation-frame loop on this, and an inline
  // arrow would tear that loop down and rebuild it on every clock tick.
  const getTime = useCallback(() => nowRef.current, []);

  const lines = useMemo(() => sortedLines(performance), [performance.lines]);
  const assets = useMemo(
    () => performance.images.map((i) => ({ key: i.key, mimeType: i.mimeType })),
    [performance.images],
  );
  const urls = useAssetUrls(performance.id, assets, remote);

  // One poll for the whole screen: the preview and the lyric follow re-render
  // at 10Hz, while the playhead reads `getTime` per frame on its own.
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

  // Space plays and pauses, except while typing a lyric. Escape closes the
  // photo panel, which is the same thing as dropping the selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === " ") {
        e.preventDefault();
        clock.toggle();
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function addImages(files: File[], beat: number) {
    setError("");
    // Several photos dropped at once are laid end to end from the drop point,
    // which is nearly always what you meant by dropping them together.
    const span = Math.max(1, performance.tempo.beatsPerBar);
    let cursor = Math.max(0, Math.round(beat));
    // One handle for the batch: the toolbar only needs to know that photos
    // are still going up, and a single entry cannot be leaked by a throw
    // part way through the loop.
    const upload = beginUpload("Photos");
    let index = 0;
    try {
      for (const file of files) {
        index += 1;
        const of = files.length > 1 ? ` (${index} of ${files.length})` : "";
        setBusy(`Uploading ${file.name}…`);
        upload.label(`Photo · ${file.name}${of}`);
        const prepared = await prepareImage(file);
        await remote.putAsset(
          performance.id,
          prepared.fields.key,
          prepared.blob,
        );
        cacheAsset(performance.id, prepared.fields.key, prepared.blob);
        const placed = placeImage(prepared.fields, cursor, span);
        update((p) => ({ ...p, images: [...p.images, placed] }));
        cursor += span;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
      upload.done();
    }
  }

  const activeIndex = lineIndexAt(lines, now);
  const chosen = performance.images.find((i) => i.id === selected) ?? null;

  // One stage, shown either on this page or in the other window. Building the
  // vnode here rather than twice is what keeps the two from drifting apart.
  const stage = (
    <PreviewStage
      performance={performance}
      time={now}
      urls={urls}
      lines={lines}
    />
  );

  return (
    <>
      <div class="workshop-top">
        <div>
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
              No backing track yet, so the workshop runs silently — you can
              still lay photos onto beats. Add the audio in step 1.
            </p>
          )}
        </div>

        <div>
          <GridPanel
            performance={performance}
            update={update}
            getNow={getTime}
            remote={remote}
          />
          {chosen && (
            <PhotoPanel
              image={chosen}
              performance={performance}
              update={update}
              getNow={getTime}
              onShow={() =>
                clock.seek(beatTime(performance.tempo, chosen.beat))
              }
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      </div>

      <Score
        performance={performance}
        update={update}
        urls={urls}
        getTime={getTime}
        onSeek={clock.seek}
        duration={clock.duration}
        activeLineId={lines[activeIndex]?.id ?? null}
        onAddImages={addImages}
        busy={busy}
        selected={selected}
        onSelect={setSelected}
      />

      {error && <p class="error">{error}</p>}
    </>
  );
}

/**
 * Tempo and downbeat, which together define the grid photos sit on.
 *
 * The anchor matters as much as the tempo here: beats are counted from it, so
 * a grid with the right bpm but the wrong starting point puts every photo
 * slightly off the music.
 */
function GridPanel({
  performance,
  update,
  getNow,
  remote,
}: {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  getNow: () => number;
  remote: RemoteStore;
}) {
  const taps = useRef<number[]>([]);
  const { bpm, beatsPerBar, anchor } = performance.tempo;

  function tapTempo() {
    const now = performance_now();
    // A long pause means a fresh count-in rather than a continuation.
    if (
      taps.current.length &&
      now - taps.current[taps.current.length - 1] > 2500
    ) {
      taps.current = [];
    }
    taps.current.push(now);
    if (taps.current.length > 8) taps.current.shift();
    if (taps.current.length < 2) return;

    const first = taps.current[0];
    const last = taps.current[taps.current.length - 1];
    const perBeat = (last - first) / (taps.current.length - 1);
    const next = Math.round(60000 / perBeat);
    if (next >= 30 && next <= 300) {
      update((p) => ({ ...p, tempo: { ...p.tempo, bpm: next } }));
    }
  }

  const beat = beatAt(performance.tempo, getNow());

  return (
    <div class="card">
      <h2>Grid</h2>
      <div class="row">
        <label class="field" style="margin:0">
          <span>BPM</span>
          <input
            type="number"
            min="30"
            max="300"
            value={bpm}
            style="width:90px"
            onInput={(e) => {
              const value = Number(e.currentTarget.value);
              if (value >= 30 && value <= 300) {
                update((p) => ({ ...p, tempo: { ...p.tempo, bpm: value } }));
              }
            }}
          />
        </label>
        <label class="field" style="margin:0">
          <span>Beats per bar</span>
          <select
            value={String(beatsPerBar)}
            style="width:80px"
            onChange={(e) => {
              const value = Number(e.currentTarget.value);
              update((p) => ({
                ...p,
                tempo: { ...p.tempo, beatsPerBar: value },
              }));
            }}
          >
            {[2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={String(n)}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
        <button onClick={tapTempo}>Tap tempo</button>
      </div>

      <div class="row" style="margin-top:10px">
        <button
          title="Put beat 0 where the playhead is"
          onClick={() =>
            update((p) => ({
              ...p,
              tempo: { ...p.tempo, anchor: Math.max(0, getNow()) },
            }))
          }
        >
          Downbeat here
        </button>
        <span class="muted">
          beat 0 at {formatTime(anchor)}
          {anchor > 0 && (
            <>
              {" · "}
              <button
                class="sm"
                onClick={() =>
                  update((p) => ({ ...p, tempo: { ...p.tempo, anchor: 0 } }))
                }
              >
                Reset
              </button>
            </>
          )}
        </span>
      </div>

      <GuessTempo performance={performance} update={update} remote={remote} />

      <p class="muted" style="margin-bottom:0">
        One beat is {secondsPerBeat(performance.tempo).toFixed(3)}s. Bar{" "}
        {Math.floor(Math.max(0, beat) / Math.max(1, beatsPerBar)) + 1} at the
        playhead, beat {Math.max(0, Math.floor(beat))} —{" "}
        {formatTime(beatTime(performance.tempo, Math.max(0, Math.floor(beat))))}
        .
      </p>
    </div>
  );
}

/**
 * Work the tempo out instead of typing it.
 *
 * Two sources, offered side by side because they suit different moments: the
 * lyric timings once a verse or two has been tapped in, the audio before
 * anything has. Both land as a proposal rather than an edit — a guess that
 * quietly replaced a tapped tempo would be worse than no guess at all, and
 * seeing the two disagree is itself worth knowing.
 */
function GuessTempo({
  performance,
  update,
  remote,
}: {
  performance: Performance;
  update: (fn: (previous: Performance) => Performance) => void;
  remote: RemoteStore;
}) {
  const [guess, setGuess] = useState<(TempoGuess & { from: string }) | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function fromLines() {
    setError("");
    setGuess(null);
    const times = sortedLines(performance).map((line) => line.time);
    const found = fitTempoToLines(times, performance.tempo.beatsPerBar);
    if (!found) {
      setError("Time at least four lyric lines in step 1 first.");
      return;
    }
    setGuess({ ...found, from: "the lyric timings" });
  }

  async function fromAudio() {
    const track = performance.backingTrack;
    setError("");
    setGuess(null);
    if (!track) {
      setError("No backing track to listen to — attach one in step 1.");
      return;
    }
    setBusy(true);
    try {
      const blob = await loadAsset(remote, performance.id, track.key);
      if (!blob) throw new Error("That track is missing from storage.");
      const found = await guessTempoFromAudio(
        blob,
        performance.tempo.beatsPerBar,
      );
      if (!found) throw new Error("That track is too short to read.");
      setGuess({ ...found, from: "the audio" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div class="row" style="margin-top:10px">
        <span class="muted">Guess it from</span>
        <button class="sm" disabled={busy} onClick={fromLines}>
          the lyric lines
        </button>
        <button class="sm" disabled={busy} onClick={fromAudio}>
          {busy ? "Listening…" : "the backing track"}
        </button>
      </div>

      {guess && (
        <p
          class={guess.confidence >= WEAK_FIT ? "ok" : "warn"}
          style="margin:8px 0 0"
        >
          <strong>{guess.bpm} bpm</strong>
          {guess.anchor !== null && `, downbeat at ${guess.anchor.toFixed(2)}s`}
          {" — from "}
          {guess.from}, {guess.detail}.{" "}
          {guess.confidence < WEAK_FIT && "A loose fit; check it by ear. "}
          <button
            class="sm"
            onClick={() => {
              const { bpm, anchor } = guess;
              update((p) => ({
                ...p,
                tempo: { ...p.tempo, bpm, anchor: anchor ?? p.tempo.anchor },
              }));
              setGuess(null);
            }}
          >
            Use it
          </button>
        </p>
      )}
      {error && <p class="error">{error}</p>}
    </>
  );
}

function performance_now(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
