import type { AppConfig } from "./config";
import { getChordInfo, QUALITIES, type ChordInfo } from "./music/chords";
import {
  DEFAULT_LAYOUT,
  LAYOUTS,
  PC_NAMES,
  type GridLayout,
} from "./music/layout";

type Listener = () => void;

/**
 * Zoom bounds. The floor is not arbitrary: smaller cells mean a larger cell
 * pool, and every cell carries a `Text`, so letting it shrink without limit
 * costs a lot of textures for labels too small to read anyway.
 */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;
/** Ratio between adjacent zoom steps. */
const ZOOM_STEP = 1.2;

/**
 * Shared, observable instrument state. The settings panel writes to it, the
 * grid reads from it every frame, so a change mid-performance takes effect on
 * the next repaint without either side knowing about the other.
 */
export class InstrumentState {
  private listeners = new Set<Listener>();

  private _rootIndex: number;
  private _qualityIndex: number;
  private _layout: GridLayout;
  private _chord: ChordInfo;
  private _playInactiveOnDrag: boolean;
  private _playInactiveOnClick: boolean;
  private _panZoneVisible: boolean;
  private _debugHitArea: boolean;
  private _zoom: number;

  constructor(config: AppConfig) {
    this._rootIndex = resolveRootIndex(config.chord.root);
    this._qualityIndex = resolveQualityIndex(config.chord.quality);
    this._layout = resolveLayout(config.grid.layout);
    this._playInactiveOnDrag = config.play.playInactiveOnDrag;
    this._playInactiveOnClick = config.play.playInactiveOnClick;
    this._panZoneVisible = resolvePanZone(config.grid.panZone);
    this._debugHitArea = config.grid.debugHitArea;
    this._zoom = clampZoom(config.grid.zoom);
    this._chord = this.computeChord();
  }

  get rootIndex(): number {
    return this._rootIndex;
  }

  set rootIndex(i: number) {
    const next = clampIndex(i, PC_NAMES.length);
    if (next === this._rootIndex) return;
    this._rootIndex = next;
    this.recompute();
  }

  get qualityIndex(): number {
    return this._qualityIndex;
  }

  set qualityIndex(i: number) {
    const next = clampIndex(i, QUALITIES.length);
    if (next === this._qualityIndex) return;
    this._qualityIndex = next;
    this.recompute();
  }

  get layout(): GridLayout {
    return this._layout;
  }

  set layout(l: GridLayout) {
    if (l.id === this._layout.id) return;
    this._layout = l;
    this.emit();
  }

  /** See `AppConfig.play.playInactiveOnDrag`. */
  get playInactiveOnDrag(): boolean {
    return this._playInactiveOnDrag;
  }

  set playInactiveOnDrag(v: boolean) {
    if (v === this._playInactiveOnDrag) return;
    this._playInactiveOnDrag = v;
    this.emit();
  }

  /** See `AppConfig.play.playInactiveOnClick`. */
  get playInactiveOnClick(): boolean {
    return this._playInactiveOnClick;
  }

  set playInactiveOnClick(v: boolean) {
    if (v === this._playInactiveOnClick) return;
    this._playInactiveOnClick = v;
    this.emit();
  }

  /**
   * True when the pan zone is a band outside the grid, which also means a
   * pointer inside it cannot sound notes. False integrates panning into the
   * grid's own margins.
   */
  get panZoneVisible(): boolean {
    return this._panZoneVisible;
  }

  set panZoneVisible(v: boolean) {
    if (v === this._panZoneVisible) return;
    this._panZoneVisible = v;
    this.emit();
  }

  /** Draw each cell's chamfered touch area, for debugging the hit geometry. */
  get debugHitArea(): boolean {
    return this._debugHitArea;
  }

  set debugHitArea(v: boolean) {
    if (v === this._debugHitArea) return;
    this._debugHitArea = v;
    this.emit();
  }

  /** Cell size multiplier; see `ZOOM_MIN` / `ZOOM_MAX`. */
  get zoom(): number {
    return this._zoom;
  }

  set zoom(v: number) {
    const next = clampZoom(v);
    if (next === this._zoom) return;
    this._zoom = next;
    this.emit();
  }

  /** Step the zoom one notch: `direction` is -1 to zoom out, +1 to zoom in. */
  zoomBy(direction: number): void {
    const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    // Rounded so repeated stepping cannot drift off the ladder.
    this.zoom = Math.round(this._zoom * factor * 1000) / 1000;
  }

  get canZoomOut(): boolean {
    return this._zoom > ZOOM_MIN;
  }

  get canZoomIn(): boolean {
    return this._zoom < ZOOM_MAX;
  }

  get root(): string {
    return PC_NAMES[this._rootIndex];
  }

  get quality() {
    return QUALITIES[this._qualityIndex];
  }

  /** The currently selected chord — drives which grid cells light up. */
  get chord(): ChordInfo {
    return this._chord;
  }

  /** Is this pitch part of the selected chord, i.e. an "active" cell? */
  isActivePitch(pitchClass: number): boolean {
    return this._chord.pitchClasses.has(pitchClass);
  }

  /** Token the grid compares to know a repaint is needed. */
  get revision(): string {
    return `${this._rootIndex}:${this._qualityIndex}:${this._layout.id}`;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private computeChord(): ChordInfo {
    return getChordInfo(
      PC_NAMES[this._rootIndex],
      QUALITIES[this._qualityIndex],
    );
  }

  private recompute() {
    this._chord = this.computeChord();
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(len - 1, Math.round(i)));
}

function resolveRootIndex(root: string): number {
  const i = PC_NAMES.indexOf(root);
  if (i >= 0) return i;
  console.warn(`[config] chord.root "${root}" is not a pitch class; using C`);
  return 0;
}

function resolveQualityIndex(label: string): number {
  const i = QUALITIES.findIndex((q) => q.label === label);
  if (i >= 0) return i;
  const known = QUALITIES.map((q) => q.label).join(", ");
  console.warn(
    `[config] chord.quality "${label}" is unknown; using maj (options: ${known})`,
  );
  return 0;
}

const PAN_ZONE_MODES = ["visible", "integrated"];

function resolvePanZone(mode: string): boolean {
  if (PAN_ZONE_MODES.includes(mode)) return mode === "visible";
  console.warn(
    `[config] grid.panZone "${mode}" is unknown; using visible (options: ${PAN_ZONE_MODES.join(", ")})`,
  );
  return true;
}

function resolveLayout(id: string): GridLayout {
  const layout = LAYOUTS[id];
  if (layout) return layout;
  const known = Object.keys(LAYOUTS).join(", ");
  console.warn(
    `[config] grid.layout "${id}" is unknown; using ${DEFAULT_LAYOUT.id} (options: ${known})`,
  );
  return DEFAULT_LAYOUT;
}
