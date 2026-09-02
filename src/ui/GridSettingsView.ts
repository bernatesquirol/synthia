import { Container, Text, TextStyle } from "pixi.js";
import { QUALITIES } from "../music/chords";
import { PC_NAMES } from "../music/layout";
import type { InstrumentState } from "../state";
import { fonts, theme } from "../theme";
import { Selector } from "./Selector";

/**
 * Controls that change constantly while playing: which chord the grid
 * highlights. Laid out top-down and reports its height so it can scroll.
 */
export class GridSettingsView extends Container {
  private chordName: Text;
  private chordNotes: Text;
  private rootSelector: Selector;
  private qualitySelector: Selector;

  private width_ = 0;

  constructor(private state: InstrumentState) {
    super();

    this.chordName = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 40,
        fontWeight: "700",
        fill: theme.textBright,
      }),
    });
    this.chordNotes = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 14,
        letterSpacing: 2,
        fill: theme.chordText,
      }),
    });
    this.addChild(this.chordName, this.chordNotes);

    this.rootSelector = new Selector({
      label: "Root",
      items: PC_NAMES,
      index: state.rootIndex,
      onChange: (i) => {
        state.rootIndex = i;
      },
    });
    this.qualitySelector = new Selector({
      label: "Chord",
      items: QUALITIES.map((q) => q.label),
      index: state.qualityIndex,
      onChange: (i) => {
        state.qualityIndex = i;
      },
    });
    this.addChild(this.rootSelector, this.qualitySelector);

    state.onChange(() => this.sync());
    this.sync();
  }

  /** Lay out to `width` and return the total content height. */
  layout(width: number, viewportHeight: number): number {
    this.width_ = width;

    const nameSize = clamp(viewportHeight * 0.11, 22, 40);
    const trackHeight = clamp(viewportHeight * 0.13, 38, 56);

    this.chordName.style.fontSize = nameSize;
    this.chordName.position.set(0, 0);

    let y = nameSize * 1.3;
    this.chordNotes.position.set(0, y);
    y += 30;

    this.rootSelector.position.set(0, y);
    this.rootSelector.resize(width, trackHeight);
    y += this.rootSelector.blockHeight + 14;

    this.qualitySelector.position.set(0, y);
    this.qualitySelector.resize(width, trackHeight);
    y += this.qualitySelector.blockHeight;

    this.sync();
    return y;
  }

  private sync(): void {
    const chord = this.state.chord;
    this.chordName.text = chord.symbol;
    this.chordNotes.text = chord.notes.join("  ");
    // Keep a long symbol from spilling past the panel edge.
    this.chordName.scale.set(1);
    if (this.width_ > 0) {
      this.chordName.scale.set(
        Math.min(1, this.width_ / Math.max(1, this.chordName.width)),
      );
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
