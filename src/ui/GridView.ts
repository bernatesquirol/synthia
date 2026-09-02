import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import type { AudioEngine } from "../audio/engine";
import {
  isPlayable,
  midiAt,
  noteNameWithOctave,
  pitchClass,
} from "../music/layout";
import type { AppConfig } from "../config";
import type { InstrumentState } from "../state";
import { fonts, theme } from "../theme";

const DEBUG_HIT_COLOR = 0xff5c8a;

/** Whether a note request came from the initial press or from a glide. */
type Phase = "press" | "drag";

interface Cell {
  view: Container;
  /** Rotated 45 degrees, so it draws the diamond as an axis-aligned square. */
  bg: Graphics;
  label: Text;
  /** Everything that affects appearance, so we only redraw on change. */
  sig: string;
}

interface PointerRecord {
  x: number;
  y: number;
  down: boolean;
  /** Cell key currently sounding for this pointer, if any. */
  cellKey: string | null;
}

/**
 * The playing surface: a tiling of 45-degree-rotated squares that scrolls
 * infinitely. See `GridLayout` for how lattice coordinates map to pitch.
 *
 * Screen position of cell (m, n) is `(m * halfDiag, n * halfDiag)` plus pan.
 * Rotating that into `s = (u + v) / 2, t = (v - u) / 2` turns the diamonds back
 * into unit squares centred on integer (S, T) — which is the frame we use for
 * hit-testing, for the corner chamfer, and for the pool's torus mapping.
 */
export class GridView extends Container {
  private cellsLayer = new Container();
  private clip = new Graphics();
  private panZone = new Graphics();
  private edgeHint = new Graphics();

  private w = 0;
  private h = 0;
  /** Half the diamond's diagonal: cell (m, n) sits at (m, n) * halfDiag. */
  private halfDiag = 80;
  private panX = 0;
  private panY = 0;
  private poolSize = 0;
  private pool: Cell[] = [];

  private pointers = new Map<number, PointerRecord>();
  private pressedCells = new Set<string>();
  private lastEdgeSig = "";
  private centred = false;
  /** Width of the pan zone band; 0 when the pan zone is integrated. */
  private inset = 0;
  /** Geometry inputs the current layout was built for. */
  private appliedGeometry = "";

  constructor(
    private state: InstrumentState,
    private engine: AudioEngine,
    private config: AppConfig,
  ) {
    super();
    this.addChild(this.cellsLayer, this.panZone, this.edgeHint, this.clip);
    this.cellsLayer.mask = this.clip;

    this.eventMode = "static";
    this.on("pointerdown", this.onPointerDown, this);
    this.on("globalpointermove", this.onPointerMove, this);
    this.on("pointerup", this.onPointerUp, this);
    this.on("pointerupoutside", this.onPointerUp, this);
    this.on("pointercancel", this.onPointerUp, this);
    this.on("pointerout", this.onPointerOut, this);
  }

  /** Side length of a cell's square, i.e. the diamond's edge. */
  private get cellSide(): number {
    return this.halfDiag * Math.SQRT2;
  }

  /**
   * The playable rect: the whole area minus the pan zone band. The lattice is
   * drawn across the full area regardless — the band only veils it.
   */
  private get playW(): number {
    return this.w - this.inset * 2;
  }

  private get playH(): number {
    return this.h - this.inset * 2;
  }

  private inPlayArea(x: number, y: number): boolean {
    return (
      x >= this.inset &&
      x <= this.inset + this.playW &&
      y >= this.inset &&
      y <= this.inset + this.playH
    );
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.relayout();
  }

  /** Rebuild the geometry that depends on size and on the pan zone mode. */
  private relayout(): void {
    if (this.w <= 0 || this.h <= 0) return;

    this.appliedGeometry = this.geometryToken();

    // Cap the band so it cannot eat the playable area on a short viewport.
    this.inset = this.state.panZoneVisible
      ? Math.min(this.config.grid.panZoneSize, Math.min(this.w, this.h) * 0.15)
      : 0;

    const fitted =
      this.config.grid.halfDiag > 0
        ? this.config.grid.halfDiag
        : clamp(Math.min(this.h / 9, this.w / 10), 44, 92);
    const nextHalfDiag = clamp(fitted * this.state.zoom, 30, 220);

    if (this.centred && nextHalfDiag !== this.halfDiag) {
      // Keep the lattice point under the viewport centre where it is, so
      // zooming feels anchored instead of jumping.
      const cx = this.w / 2;
      const cy = this.h / 2;
      const mC = (cx - this.panX) / this.halfDiag;
      const nC = (cy - this.panY) / this.halfDiag;
      this.panX = cx - mC * nextHalfDiag;
      this.panY = cy - nC * nextHalfDiag;
    }
    this.halfDiag = nextHalfDiag;

    this.clip.clear().rect(0, 0, this.w, this.h).fill({ color: 0xffffff });

    this.drawPanZone();

    if (!this.centred) {
      this.centreOnOrigin();
      this.centred = true;
    }
    this.rebuildPool();
    // Cell painting is cached against a signature that cannot see the cell
    // size, so any geometry change has to invalidate it explicitly.
    for (const cell of this.pool) cell.sig = "";
    this.clampPan();
    this.lastEdgeSig = "";
  }

  /** Inputs that require the geometry to be rebuilt when they change. */
  private geometryToken(): string {
    return this.state.panZoneVisible + "|" + this.state.zoom;
  }

  /** Advance auto-pan and repaint. Called once per frame. */
  update(deltaMs: number): void {
    if (this.geometryToken() !== this.appliedGeometry) this.relayout();
    this.applyEdgePan(deltaMs);
    this.refreshCells();
  }

  releaseAll(): void {
    for (const [id, rec] of this.pointers) {
      if (rec.down) this.engine.noteOff(id);
    }
    this.pointers.clear();
    this.pressedCells.clear();
  }

  // ---------------------------------------------------------------- pointers

  private onPointerDown(e: FederatedPointerEvent): void {
    const p = e.getLocalPosition(this);
    const rec: PointerRecord = { x: p.x, y: p.y, down: true, cellKey: null };
    this.pointers.set(e.pointerId, rec);
    this.updateVoice(e.pointerId, rec, "press");
  }

  private onPointerMove(e: FederatedPointerEvent): void {
    const p = e.getLocalPosition(this);
    const inside = p.x >= 0 && p.x <= this.w && p.y >= 0 && p.y <= this.h;
    const existing = this.pointers.get(e.pointerId);

    if (!existing) {
      // Hover tracking only starts inside the grid; presses come via pointerdown.
      if (!inside) return;
      this.pointers.set(e.pointerId, {
        x: p.x,
        y: p.y,
        down: false,
        cellKey: null,
      });
      return;
    }

    if (existing.down) {
      // Held fingers keep playing (and keep panning) if they slip off the edge.
      existing.x = clamp(p.x, 0, this.w);
      existing.y = clamp(p.y, 0, this.h);
      this.updateVoice(e.pointerId, existing, "drag");
    } else if (inside) {
      existing.x = p.x;
      existing.y = p.y;
    } else {
      this.pointers.delete(e.pointerId);
    }
  }

  private onPointerUp(e: FederatedPointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    if (rec.down) {
      this.engine.noteOff(e.pointerId);
      if (rec.cellKey) this.pressedCells.delete(rec.cellKey);
    }
    this.pointers.delete(e.pointerId);
  }

  private onPointerOut(e: FederatedPointerEvent): void {
    const rec = this.pointers.get(e.pointerId);
    if (rec && !rec.down) this.pointers.delete(e.pointerId);
  }

  /** Map a pointer position to a cell and (re)trigger its note. */
  private updateVoice(
    pointerId: number,
    rec: PointerRecord,
    phase: Phase,
  ): void {
    // A pointer in the pan zone pans instead of playing, so drop its note.
    if (!this.inPlayArea(rec.x, rec.y)) {
      if (rec.cellKey) {
        this.pressedCells.delete(rec.cellKey);
        rec.cellKey = null;
      }
      this.engine.noteOff(pointerId);
      return;
    }

    const a = this.halfDiag;
    const u = (rec.x - this.panX) / a;
    const v = (rec.y - this.panY) / a;
    // In (s, t) the diamonds are unit squares on integer coordinates, so the
    // containing cell is just the nearest integer pair.
    const s = (u + v) / 2;
    const t = (v - u) / 2;
    const sI = Math.round(s);
    const tI = Math.round(t);

    // The touch area is the cell with its corners chamfered off. A glide
    // crosses those dead zones, and retriggering there would fire a spurious
    // note from whichever neighbour won the rounding; instead we hold whatever
    // is already sounding until the finger reaches a cell proper.
    if (
      !insideHitArea(s - sI + 0.5, t - tI + 0.5, this.config.grid.cornerCut)
    ) {
      return;
    }

    const m = sI - tI;
    const n = sI + tI;
    const key = m + "," + n;
    if (key === rec.cellKey) return;

    const midi = midiAt(this.state.layout, m, n);

    // Cells outside the chord can be muted independently for a press and for a
    // glide. Bailing out here holds whatever is already sounding, so with
    // `playInactiveOnDrag` off a drag arpeggiates the chord instead of gapping
    // into silence between its tones.
    if (
      !this.state.isActivePitch(pitchClass(midi)) &&
      !(phase === "press"
        ? this.state.playInactiveOnClick
        : this.state.playInactiveOnDrag)
    ) {
      return;
    }

    if (rec.cellKey) this.pressedCells.delete(rec.cellKey);

    if (!isPlayable(midi)) {
      rec.cellKey = null;
      this.engine.noteOff(pointerId);
      return;
    }

    rec.cellKey = key;
    this.pressedCells.add(key);
    this.engine.noteOn(pointerId, midi);
  }

  // ------------------------------------------------------------------ panning

  private centreOnOrigin(): void {
    this.panX = this.w / 2;
    this.panY = this.h / 2;
  }

  private applyEdgePan(deltaMs: number): void {
    let vx = 0;
    let vy = 0;
    for (const rec of this.pointers.values()) {
      vx = pickStronger(vx, this.axisVelocity(rec.x, this.playW));
      vy = pickStronger(vy, this.axisVelocity(rec.y, this.playH));
    }

    if (vx !== 0 || vy !== 0) {
      const dt = deltaMs / 1000;
      const speed = this.config.grid.panSpeed;
      this.panX += vx * speed * dt;
      this.panY += vy * speed * dt;
      this.clampPan();
      // A finger held at the edge keeps sliding over new cells.
      for (const [id, rec] of this.pointers) {
        if (rec.down) this.updateVoice(id, rec, "drag");
      }
    }
    this.drawEdgeHint(vx, vy);
  }

  /**
   * -1..1 pan intensity for one axis. With a visible pan zone the ramp lives
   * entirely in the band outside the play rect; integrated, it ramps up inside
   * the grid's own margin.
   */
  private axisVelocity(pos: number, playSize: number): number {
    if (this.inset <= 0) {
      return edgeVelocity(pos, playSize, this.config.grid.edgeMargin);
    }
    const start = this.inset;
    if (pos < start) return clamp((start - pos) / this.inset, 0, 1);
    const end = start + playSize;
    if (pos > end) return -clamp((pos - end) / this.inset, 0, 1);
    return 0;
  }

  private clampPan(): void {
    const { mRange, nRange } = this.state.layout;
    const a = this.halfDiag;
    const cx = this.w / 2;
    const cy = this.h / 2;
    this.panX = clamp(this.panX, cx - mRange[1] * a, cx - mRange[0] * a);
    this.panY = clamp(this.panY, cy - nRange[1] * a, cy - nRange[0] * a);
  }

  private drawPanZone(): void {
    const g = this.panZone.clear();
    if (this.inset <= 0) return;

    const i = this.inset;
    const w = this.w;
    const h = this.h;
    // Four bands around the play rect, drawn as one path. Semi-transparent so
    // the notes you are panning towards stay readable underneath.
    g.rect(0, 0, w, i)
      .rect(0, h - i, w, i)
      .rect(0, i, i, h - i * 2)
      .rect(w - i, i, i, h - i * 2)
      .fill({
        color: theme.panZoneBg,
        alpha: clamp(this.config.grid.panZoneOpacity, 0, 1),
      })
      .rect(i, i, this.playW, this.playH)
      .stroke({ width: 1, color: theme.panZoneBorder, alignment: 0 });
  }

  private drawEdgeHint(vx: number, vy: number): void {
    const sig = vx.toFixed(2) + "," + vy.toFixed(2);
    if (sig === this.lastEdgeSig) return;
    this.lastEdgeSig = sig;

    const g = this.edgeHint.clear();
    // Light up the band itself when it exists, otherwise a thin bar on the edge.
    const bar = this.inset > 0 ? this.inset : 5;
    const alphaScale = this.inset > 0 ? 0.35 : 0.75;
    const paint = (x: number, y: number, w: number, h: number, a: number) => {
      if (a <= 0.001) return;
      g.rect(x, y, w, h).fill({
        color: theme.accent,
        alpha: Math.min(alphaScale, a * alphaScale),
      });
    };
    paint(0, 0, bar, this.h, Math.max(0, vx));
    paint(this.w - bar, 0, bar, this.h, Math.max(0, -vx));
    paint(0, 0, this.w, bar, Math.max(0, vy));
    paint(0, this.h - bar, this.w, bar, Math.max(0, -vy));
  }

  // ------------------------------------------------------------------ drawing

  /**
   * The visible screen rect becomes a diamond in (s, t), so its bounding box
   * spans `(w + h) / 2a` on both axes — roughly twice the cells actually on
   * screen. The surplus slots are simply hidden each frame.
   */
  private poolSpan(): number {
    return Math.ceil((this.w + this.h) / (2 * this.halfDiag)) + 3;
  }

  private rebuildPool(): void {
    const span = this.poolSpan();
    if (span === this.poolSize) return;

    this.cellsLayer.removeChildren();
    this.pool = [];
    this.poolSize = span;

    for (let i = 0; i < span * span; i++) {
      const view = new Container();
      const bg = new Graphics();
      // Draw an axis-aligned square and rotate it; the label stays upright
      // because it is a sibling rather than a child of the shape.
      bg.rotation = Math.PI / 4;
      const label = new Text({
        text: "",
        style: new TextStyle({
          fontFamily: fonts.ui,
          fontSize: 15,
          fontWeight: "600",
          fill: theme.cellText,
          align: "center",
        }),
      });
      label.anchor.set(0.5);
      view.addChild(bg, label);
      this.cellsLayer.addChild(view);
      this.pool.push({ view, bg, label, sig: "" });
    }
  }

  private refreshCells(): void {
    if (this.pool.length === 0) return;

    const a = this.halfDiag;
    const span = this.poolSize;
    const layout = this.state.layout;
    const chord = this.state.chord;
    const rev = this.state.revision;

    const uMin = -this.panX / a;
    const uMax = (this.w - this.panX) / a;
    const vMin = -this.panY / a;
    // s is minimised at (uMin, vMin), t at (uMax, vMin).
    const sStart = Math.floor((uMin + vMin) / 2) - 1;
    const tStart = Math.floor((vMin - uMax) / 2) - 1;

    for (let dS = 0; dS < span; dS++) {
      const sI = sStart + dS;
      for (let dT = 0; dT < span; dT++) {
        const tI = tStart + dT;
        const slot = mod(sI, span) * span + mod(tI, span);
        const cell = this.pool[slot];

        const m = sI - tI;
        const n = sI + tI;
        const cx = m * a + this.panX;
        const cy = n * a + this.panY;

        const onScreen =
          cx > -a && cx < this.w + a && cy > -a && cy < this.h + a;
        cell.view.visible = onScreen;
        if (!onScreen) continue;
        cell.view.position.set(cx, cy);

        const midi = midiAt(layout, m, n);
        const playable = isPlayable(midi);
        const pc = pitchClass(midi);
        const inChord = playable && chord.pitchClasses.has(pc);
        const isRoot = inChord && pc === chord.rootPc;
        const pressed = this.pressedCells.has(m + "," + n);

        const flags =
          (playable ? "1" : "0") +
          (inChord ? "1" : "0") +
          (isRoot ? "1" : "0") +
          (pressed ? "1" : "0");
        const sig =
          rev + "|" + midi + "|" + flags + (this.state.debugHitArea ? "d" : "");
        if (sig === cell.sig) continue;
        cell.sig = sig;
        this.paintCell(cell, midi, { playable, inChord, isRoot, pressed });
      }
    }
  }

  private paintCell(
    cell: Cell,
    midi: number,
    s: {
      playable: boolean;
      inChord: boolean;
      isRoot: boolean;
      pressed: boolean;
    },
  ): void {
    const side = this.cellSide;
    let fill: number = theme.cellBg;
    let border: number = theme.cellBorder;
    let text: number = theme.cellText;
    let borderWidth = 1;

    if (!s.playable) {
      border = theme.cellBg;
      text = theme.outText;
    } else if (s.pressed) {
      fill = theme.pressedBg;
      border = theme.pressedBorder;
      text = theme.pressedText;
      borderWidth = 2;
    } else if (s.isRoot) {
      fill = theme.rootBg;
      border = theme.rootBorder;
      text = theme.rootText;
      borderWidth = 2;
    } else if (s.inChord) {
      fill = theme.chordBg;
      border = theme.chordBorder;
      text = theme.chordText;
    }

    // Both shapes are drawn in the rotated frame. The diamond is inset by the
    // gap; the touch area is at full cell size, so the two visibly differ.
    const drawn = side - this.config.grid.gap;
    cell.bg
      .clear()
      .roundRect(-drawn / 2, -drawn / 2, drawn, drawn, Math.max(4, side * 0.11))
      .fill({ color: fill })
      .stroke({ width: borderWidth, color: border, alignment: 1 });

    if (this.state.debugHitArea) {
      cell.bg
        .poly(chamferedSquare(side, this.config.grid.cornerCut))
        .stroke({ width: 1, color: DEBUG_HIT_COLOR, alpha: 0.9 });
    }

    const showLabel = s.playable && side >= 34;
    cell.label.text = showLabel ? noteNameWithOctave(midi) : "";
    cell.label.style.fill = text;
    cell.label.style.fontSize = Math.max(10, Math.round(side * 0.24));
    cell.label.position.set(0, 0);
  }
}

/**
 * Is a point inside the chamfered touch area? `u`/`v` are the position within
 * the cell's own (rotated) square, normalised to 0..1.
 */
function insideHitArea(u: number, v: number, cornerCut: number): boolean {
  const du = Math.abs(u - 0.5);
  const dv = Math.abs(v - 0.5);
  return du + dv <= 1 - cornerCut;
}

/** Outline of the chamfered touch area, centred on the origin. */
function chamferedSquare(size: number, cornerCut: number): number[] {
  const half = size / 2;
  const cut = size * cornerCut;
  return [
    cut - half,
    -half,
    half - cut,
    -half,
    half,
    cut - half,
    half,
    half - cut,
    half - cut,
    half,
    cut - half,
    half,
    -half,
    half - cut,
    -half,
    cut - half,
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** -1..1 pan intensity for a coordinate near either end of `size`. */
function edgeVelocity(pos: number, size: number, edgeMargin: number): number {
  const margin = Math.min(edgeMargin, size / 4);
  if (pos < margin) return 1 - pos / margin;
  if (pos > size - margin) return -(1 - (size - pos) / margin);
  return 0;
}

function pickStronger(a: number, b: number): number {
  return Math.abs(b) > Math.abs(a) ? b : a;
}
