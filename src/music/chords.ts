import { Chord, Note } from "tonal";

/** Chord qualities exposed by the settings selector, in tonal's type names. */
export interface Quality {
  /** tonal chord type name */
  type: string;
  /** short label for the selector segment */
  label: string;
  /** suffix appended to the root in the readout, e.g. "" for plain major */
  suffix: string;
}

export const QUALITIES: Quality[] = [
  { type: "major", label: "maj", suffix: "" },
  { type: "minor", label: "min", suffix: "m" },
  { type: "dominant seventh", label: "7", suffix: "7" },
  { type: "major seventh", label: "maj7", suffix: "maj7" },
  { type: "minor seventh", label: "m7", suffix: "m7" },
  { type: "diminished", label: "dim", suffix: "dim" },
  { type: "half-diminished", label: "m7b5", suffix: "m7♭5" },
  { type: "augmented", label: "aug", suffix: "aug" },
  { type: "suspended fourth", label: "sus4", suffix: "sus4" },
  { type: "sixth", label: "6", suffix: "6" },
];

export function qualityByLabel(label: string): Quality {
  return QUALITIES.find((q) => q.label === label) ?? QUALITIES[0];
}

/** Lead-sheet name for a root plus a quality label, e.g. ("A", "m7") -> "Am7". */
export function chordSymbol(root: string, qualityLabel: string): string {
  return root + qualityByLabel(qualityLabel).suffix;
}

export interface ChordInfo {
  /** Display name, e.g. "Dmaj7". */
  symbol: string;
  /** Note names in the chord, e.g. ["D", "F#", "A", "C#"]. */
  notes: string[];
  /** Absolute pitch classes (0 = C) present in the chord. */
  pitchClasses: Set<number>;
  /** Pitch class of the chord root. */
  rootPc: number;
}

export function getChordInfo(root: string, quality: Quality): ChordInfo {
  const chord = Chord.getChord(quality.type, root);
  const pitchClasses = new Set<number>();
  for (const n of chord.notes) {
    const pc = Note.chroma(n);
    if (pc !== undefined) pitchClasses.add(pc);
  }
  return {
    // tonal spells C major as "CM"; the conventional lead-sheet name reads better.
    symbol: root + quality.suffix,
    notes: chord.notes,
    pitchClasses,
    rootPc: Note.chroma(root) ?? 0,
  };
}
