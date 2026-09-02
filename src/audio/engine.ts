import * as Tone from "tone";
import type { AppConfig } from "../config";

const WAVEFORMS = ["sine", "triangle", "square", "sawtooth"] as const;
type Waveform = (typeof WAVEFORMS)[number];

/**
 * Thin polyphonic wrapper over Tone.
 *
 * Voices are addressed by an opaque id (we use the pointer id) so that a finger
 * sliding across cells can retrigger cleanly, and lifting it releases only its
 * own note. Because `PolySynth` releases by frequency, we refcount notes: two
 * fingers on the same pitch must both lift before it stops.
 */
export class AudioEngine {
  private synth: Tone.PolySynth<Tone.Synth> | null = null;
  private started = false;

  /** voiceId -> midi currently sounding for that voice */
  private voiceNote = new Map<number, number>();
  /** midi -> how many voices are holding it */
  private noteRefs = new Map<number, number>();

  constructor(private config: AppConfig) {}

  get isStarted(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();

    const { volume, reverbWet, maxPolyphony } = this.config.audio;

    const limiter = new Tone.Limiter(-3).toDestination();
    const reverb = new Tone.Reverb({
      decay: 2.4,
      wet: clamp01(reverbWet),
    }).connect(limiter);

    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: resolveWaveform(this.config.audio.waveform) },
      envelope: { attack: 0.008, decay: 0.18, sustain: 0.55, release: 0.5 },
    }).connect(reverb);
    this.synth.maxPolyphony = Math.max(1, Math.round(maxPolyphony));
    this.synth.volume.value = volume;

    this.started = true;
  }

  /** Start (or move) the note held by `voiceId`. No-op if already on that pitch. */
  noteOn(voiceId: number, midi: number): void {
    if (!this.synth) return;
    const current = this.voiceNote.get(voiceId);
    if (current === midi) return;
    if (current !== undefined) this.release(current);

    this.voiceNote.set(voiceId, midi);
    const refs = this.noteRefs.get(midi) ?? 0;
    this.noteRefs.set(midi, refs + 1);
    if (refs === 0) {
      this.synth.triggerAttack(Tone.Frequency(midi, "midi").toFrequency());
    }
  }

  noteOff(voiceId: number): void {
    const midi = this.voiceNote.get(voiceId);
    if (midi === undefined) return;
    this.voiceNote.delete(voiceId);
    this.release(midi);
  }

  releaseAll(): void {
    for (const voiceId of [...this.voiceNote.keys()]) this.noteOff(voiceId);
  }

  private release(midi: number): void {
    const refs = (this.noteRefs.get(midi) ?? 1) - 1;
    if (refs > 0) {
      this.noteRefs.set(midi, refs);
      return;
    }
    this.noteRefs.delete(midi);
    this.synth?.triggerRelease(Tone.Frequency(midi, "midi").toFrequency());
  }
}

function resolveWaveform(name: string): Waveform {
  if ((WAVEFORMS as readonly string[]).includes(name)) return name as Waveform;
  console.warn(
    `[config] audio.waveform "${name}" is unknown; using triangle (options: ${WAVEFORMS.join(", ")})`,
  );
  return "triangle";
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
