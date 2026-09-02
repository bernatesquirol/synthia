/**
 * The grid is a tiling of squares rotated 45 degrees, i.e. diamonds.
 *
 * Diamond centres sit at `(m * a, n * a)` for every integer pair where `m + n`
 * is even (`a` = half the diamond's diagonal). Odd sums are the gaps between
 * them, so they are not cells. Stepping to the diamond that touches the east
 * corner is `m += 2`; the one touching the north corner is `n -= 2`.
 *
 * Two intervals define the whole lattice: `eastStep` along the horizontal
 * (chromatic) and `northStep` up the vertical (fifths). Everything else falls
 * out of it — the four edge-sharing neighbours are the half-sums, so with
 * (1, 7) the diagonals become +4 up-right and +3 up-left. That is exactly the
 * Tonnetz: semitones across, fifths up, major and minor thirds on the edges.
 */
export interface GridLayout {
  id: string;
  name: string;
  /** Semitones added stepping east to the next diamond (m += 2). */
  eastStep: number;
  /** Semitones added stepping north to the next diamond (n -= 2). */
  northStep: number;
  /** MIDI note at cell (0, 0). */
  baseMidi: number;
  /** Pan limits in lattice units, measured at the viewport centre. */
  mRange: [number, number];
  nRange: [number, number];
}

/**
 * `eastStep` and `northStep` must share parity. `midiAt` halves
 * `m * eastStep - n * northStep`, and only matching parity keeps that even for
 * every cell on the `m + n` even sublattice — otherwise cells land on
 * quarter-tones.
 */
export const LAYOUTS: Record<string, GridLayout> = {
  /** Semitones east, fifths north. Thirds fall on the diagonals. */
  tonnetz: {
    id: "tonnetz",
    name: "Tonnetz",
    eastStep: 1,
    northStep: 7,
    baseMidi: 60,
    mRange: [-20, 20],
    nRange: [-10, 10],
  },
  /** Semitones east, fourths north. */
  fourths: {
    id: "fourths",
    name: "Fourths",
    eastStep: 1,
    northStep: 5,
    baseMidi: 60,
    mRange: [-20, 20],
    nRange: [-14, 14],
  },
};

export const DEFAULT_LAYOUT = LAYOUTS.tonnetz;

/** MIDI pitch of the diamond centred at lattice coordinate (m, n). */
export function midiAt(layout: GridLayout, m: number, n: number): number {
  return layout.baseMidi + (m * layout.eastStep - n * layout.northStep) / 2;
}

export const MIDI_MIN = 21;
export const MIDI_MAX = 108;

export function isPlayable(midi: number): boolean {
  return midi >= MIDI_MIN && midi <= MIDI_MAX;
}

const PC_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function noteName(midi: number): string {
  return PC_NAMES[pitchClass(midi)];
}

export function noteNameWithOctave(midi: number): string {
  return `${PC_NAMES[pitchClass(midi)]}${Math.floor(midi / 12) - 1}`;
}

export { PC_NAMES };
