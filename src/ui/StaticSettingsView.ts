import { Container, Text, TextStyle } from "pixi.js";
import type { InstrumentState } from "../state";
import { fonts, theme } from "../theme";
import { Stepper } from "./Stepper";
import { Toggle, TOGGLE_GAP } from "./Toggle";

interface Row {
  view: Toggle | Stepper;
}

interface Group {
  heading: Text;
  rows: Row[];
}

/**
 * Settings you set up before playing rather than during: how the grid responds
 * to touch. Reached from the panel header, and scrolls if it does not fit.
 */
export class StaticSettingsView extends Container {
  private groups: Group[] = [];
  private syncFns: (() => void)[] = [];

  constructor(state: InstrumentState) {
    super();

    this.addGroup("PLAYING", [
      {
        label: "Off-chord cells play on drag",
        get: () => state.playInactiveOnDrag,
        set: (v) => {
          state.playInactiveOnDrag = v;
        },
      },
      {
        label: "Off-chord cells play on press",
        get: () => state.playInactiveOnClick,
        set: (v) => {
          state.playInactiveOnClick = v;
        },
      },
    ]);

    this.addGroup("GRID", [
      {
        label: "Pan zone outside the grid",
        get: () => state.panZoneVisible,
        set: (v) => {
          state.panZoneVisible = v;
        },
      },
      {
        label: "Show touch areas",
        get: () => state.debugHitArea,
        set: (v) => {
          state.debugHitArea = v;
        },
      },
    ]);

    const zoom = new Stepper({
      label: "Zoom",
      onStep: (dir) => state.zoomBy(dir),
    });
    this.addRowToLastGroup(zoom);
    this.syncFns.push(() =>
      zoom.setState(
        Math.round(state.zoom * 100) + "%",
        state.canZoomOut,
        state.canZoomIn,
      ),
    );

    state.onChange(() => this.sync());
    this.sync();
  }

  private addGroup(
    title: string,
    rows: {
      label: string;
      get: () => boolean;
      set: (v: boolean) => void;
    }[],
  ): void {
    const heading = new Text({
      text: title,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 1.4,
        fill: theme.textDim,
      }),
    });
    this.addChild(heading);

    const built = rows.map((row) => {
      const toggle = new Toggle({
        label: row.label,
        value: row.get(),
        onChange: row.set,
      });
      this.addChild(toggle);
      this.syncFns.push(() => toggle.setValue(row.get(), false));
      return { view: toggle };
    });

    this.groups.push({ heading, rows: built });
  }

  private addRowToLastGroup(view: Stepper): void {
    this.addChild(view);
    this.groups[this.groups.length - 1].rows.push({ view });
  }

  /** Lay out to `width` and return the total content height. */
  layout(width: number): number {
    let y = 0;
    for (const group of this.groups) {
      group.heading.position.set(0, y);
      y += 22;
      for (const row of group.rows) {
        row.view.position.set(0, y);
        row.view.resize(width);
        y += row.view.rowHeight + TOGGLE_GAP;
      }
      y += 14;
    }
    return y;
  }

  private sync(): void {
    for (const fn of this.syncFns) fn();
  }
}
