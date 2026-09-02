import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, metrics, theme } from "../theme";

export interface SelectorOptions {
  label: string;
  items: string[];
  index?: number;
  onChange: (index: number) => void;
}

const LABEL_HEIGHT = 22;

/**
 * A horizontal segmented control. Tap a segment or drag across the strip to
 * scrub through values. Each instance tracks its own pointer id, so two of them
 * can be operated with two fingers at the same time.
 */
export class Selector extends Container {
  private items: string[];
  private index: number;
  private onChange: (index: number) => void;

  private labelText: Text;
  private track = new Graphics();
  private itemTexts: Text[] = [];

  private activePointer: number | null = null;
  private trackWidth = 0;
  private trackHeight = 0;

  constructor(opts: SelectorOptions) {
    super();
    this.items = opts.items;
    this.index = opts.index ?? 0;
    this.onChange = opts.onChange;

    this.labelText = new Text({
      text: opts.label.toUpperCase(),
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 1.4,
        fill: theme.textDim,
      }),
    });
    this.addChild(this.labelText);
    this.addChild(this.track);

    for (const item of this.items) {
      const t = new Text({
        text: item,
        style: new TextStyle({
          fontFamily: fonts.ui,
          fontSize: 13,
          fontWeight: "600",
          fill: theme.textDim,
          align: "center",
        }),
      });
      t.anchor.set(0.5);
      this.itemTexts.push(t);
      this.addChild(t);
    }

    this.eventMode = "static";
    this.on("pointerdown", this.handleDown, this);
    this.on("globalpointermove", this.handleMove, this);
    this.on("pointerup", this.handleUp, this);
    this.on("pointerupoutside", this.handleUp, this);
    this.on("pointercancel", this.handleUp, this);
  }

  /** Total height including the caption above the track. */
  get blockHeight(): number {
    return LABEL_HEIGHT + this.trackHeight;
  }

  resize(width: number, trackHeight: number): void {
    this.trackWidth = width;
    this.trackHeight = trackHeight;
    this.hitArea = new Rectangle(0, LABEL_HEIGHT, width, trackHeight);
    this.redraw();
  }

  setIndex(index: number, notify = true): void {
    const next = Math.max(0, Math.min(this.items.length - 1, index));
    if (next === this.index) return;
    this.index = next;
    this.redraw();
    if (notify) this.onChange(next);
  }

  private indexFromX(x: number): number {
    const seg = this.trackWidth / this.items.length;
    return Math.floor(x / seg);
  }

  private handleDown(e: FederatedPointerEvent): void {
    // Scrubbing is our gesture: keep it from reaching an enclosing ScrollView.
    e.stopPropagation();
    if (this.activePointer !== null) return;
    this.activePointer = e.pointerId;
    this.setIndex(this.indexFromX(e.getLocalPosition(this).x));
  }

  private handleMove(e: FederatedPointerEvent): void {
    if (this.activePointer !== e.pointerId) return;
    this.setIndex(this.indexFromX(e.getLocalPosition(this).x));
  }

  private handleUp(e: FederatedPointerEvent): void {
    if (this.activePointer !== e.pointerId) return;
    this.activePointer = null;
  }

  private redraw(): void {
    const w = this.trackWidth;
    const h = this.trackHeight;
    if (w <= 0 || h <= 0) return;

    const top = LABEL_HEIGHT;
    const seg = w / this.items.length;

    this.track
      .clear()
      .roundRect(0, top, w, h, metrics.radius)
      .fill({ color: theme.trackBg })
      .stroke({ width: 1, color: theme.trackBorder, alignment: 0 });

    // Selected pill.
    const pad = 3;
    this.track
      .roundRect(
        this.index * seg + pad,
        top + pad,
        seg - pad * 2,
        h - pad * 2,
        metrics.radius - 3,
      )
      .fill({ color: theme.accent, alpha: 0.9 });

    // Fit the longest label inside a segment.
    const longest = this.items.reduce(
      (a, b) => (a.length >= b.length ? a : b),
      "",
    );
    const fontSize = Math.max(
      9,
      Math.min(14, Math.floor((seg - 6) / (longest.length * 0.62))),
    );

    this.itemTexts.forEach((t, i) => {
      t.style.fontSize = fontSize;
      t.style.fill = i === this.index ? 0x08120f : theme.textDim;
      t.position.set(i * seg + seg / 2, top + h / 2);
    });
  }
}
