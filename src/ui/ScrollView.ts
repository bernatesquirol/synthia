import {
  Container,
  FederatedPointerEvent,
  FederatedWheelEvent,
  Graphics,
  Rectangle,
} from "pixi.js";
import { theme } from "../theme";

/** Vertical travel, in px, before a press becomes a scroll drag. */
const DRAG_THRESHOLD = 7;
const BAR_WIDTH = 3;

/**
 * A vertically scrolling viewport. Add children to `content` and report their
 * total height with `setContentHeight`.
 *
 * Scroll starts from a drag anywhere in the viewport, so widgets that need the
 * raw gesture themselves (a scrub selector) must call `stopPropagation()` on
 * pointerdown — that keeps the event from reaching us. Widgets that only need a
 * tap (a toggle) should instead ignore presses that travelled, so a drag
 * beginning on top of them still scrolls.
 */
export class ScrollView extends Container {
  readonly content = new Container();

  private clip = new Graphics();
  private bar = new Graphics();

  private viewW = 0;
  private viewH = 0;
  private contentH = 0;
  private offset = 0;

  private dragId: number | null = null;
  private dragStartY = 0;
  private dragStartOffset = 0;
  private dragging = false;

  constructor() {
    super();
    this.addChild(this.content, this.bar, this.clip);
    this.content.mask = this.clip;

    this.eventMode = "static";
    this.on("pointerdown", this.onDown, this);
    this.on("globalpointermove", this.onMove, this);
    this.on("pointerup", this.onUp, this);
    this.on("pointerupoutside", this.onUp, this);
    this.on("pointercancel", this.onUp, this);
    this.on("wheel", this.onWheel, this);
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.clip.clear().rect(0, 0, width, height).fill({ color: 0xffffff });
    this.applyOffset();
  }

  setContentHeight(height: number): void {
    this.contentH = height;
    this.applyOffset();
  }

  /** True when the content is taller than the viewport. */
  get scrollable(): boolean {
    return this.contentH > this.viewH;
  }

  private get minOffset(): number {
    return Math.min(0, this.viewH - this.contentH);
  }

  private applyOffset(): void {
    this.offset = clamp(this.offset, this.minOffset, 0);
    this.content.y = Math.round(this.offset);
    this.drawBar();
  }

  private onDown(e: FederatedPointerEvent): void {
    if (this.dragId !== null) return;
    this.dragId = e.pointerId;
    this.dragStartY = e.global.y;
    this.dragStartOffset = this.offset;
    this.dragging = false;
  }

  private onMove(e: FederatedPointerEvent): void {
    if (this.dragId !== e.pointerId) return;
    const dy = e.global.y - this.dragStartY;
    if (!this.dragging) {
      if (Math.abs(dy) < DRAG_THRESHOLD) return;
      this.dragging = true;
    }
    this.offset = this.dragStartOffset + dy;
    this.applyOffset();
  }

  private onUp(e: FederatedPointerEvent): void {
    if (this.dragId !== e.pointerId) return;
    this.dragId = null;
    this.dragging = false;
  }

  private onWheel(e: FederatedWheelEvent): void {
    if (!this.scrollable) return;
    this.offset -= e.deltaY;
    this.applyOffset();
  }

  private drawBar(): void {
    const g = this.bar.clear();
    if (!this.scrollable || this.viewH <= 0) return;

    const thumbH = Math.max(24, (this.viewH * this.viewH) / this.contentH);
    const travel = this.viewH - thumbH;
    const progress = this.minOffset === 0 ? 0 : this.offset / this.minOffset;
    const y = clamp(progress, 0, 1) * travel;

    g.roundRect(
      this.viewW - BAR_WIDTH - 2,
      y,
      BAR_WIDTH,
      thumbH,
      BAR_WIDTH / 2,
    ).fill({ color: theme.textDim, alpha: 0.45 });
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
