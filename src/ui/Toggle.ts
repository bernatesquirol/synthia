import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, metrics, theme } from "../theme";

export interface ToggleOptions {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

const SWITCH_WIDTH = 44;
const SWITCH_HEIGHT = 24;
/** How far a press may travel and still count as a tap rather than a scroll. */
const TAP_SLOP = 7;

/** A compact label-plus-switch row. Tapping anywhere on the row flips it. */
export class Toggle extends Container {
  private value: boolean;
  private onChange: (value: boolean) => void;

  private labelText: Text;
  private track = new Graphics();

  private width_ = 0;
  private height_ = SWITCH_HEIGHT;
  private downId: number | null = null;
  private downX = 0;
  private downY = 0;

  constructor(opts: ToggleOptions) {
    super();
    this.value = opts.value;
    this.onChange = opts.onChange;

    this.labelText = new Text({
      text: opts.label,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 12,
        fill: theme.textDim,
        wordWrap: true,
        wordWrapWidth: 200,
        lineHeight: 15,
      }),
    });
    this.addChild(this.labelText, this.track);

    this.eventMode = "static";
    this.cursor = "pointer";
    // Deliberately no stopPropagation: a drag starting on this row should be
    // free to scroll the panel, so we only flip when the press barely moved.
    this.on("pointerdown", this.onDown, this);
    this.on("pointerup", this.onUp, this);
    this.on("pointerupoutside", this.onCancel, this);
    this.on("pointercancel", this.onCancel, this);
  }

  /** Row height, which depends on how far the label wrapped. */
  get rowHeight(): number {
    return this.height_;
  }

  resize(width: number): void {
    this.width_ = width;
    this.labelText.style.wordWrapWidth = Math.max(
      40,
      width - SWITCH_WIDTH - 14,
    );
    this.height_ = Math.max(SWITCH_HEIGHT, this.labelText.height);
    this.hitArea = new Rectangle(0, 0, width, this.height_);
    this.redraw();
  }

  setValue(value: boolean, notify = true): void {
    if (value === this.value) return;
    this.value = value;
    this.redraw();
    if (notify) this.onChange(value);
  }

  private onDown(e: FederatedPointerEvent): void {
    this.downId = e.pointerId;
    this.downX = e.global.x;
    this.downY = e.global.y;
  }

  private onUp(e: FederatedPointerEvent): void {
    if (this.downId !== e.pointerId) return;
    this.downId = null;
    const travelled =
      Math.abs(e.global.x - this.downX) + Math.abs(e.global.y - this.downY);
    if (travelled <= TAP_SLOP) this.setValue(!this.value);
  }

  private onCancel(e: FederatedPointerEvent): void {
    if (this.downId === e.pointerId) this.downId = null;
  }

  private redraw(): void {
    if (this.width_ <= 0) return;

    this.labelText.position.set(0, (this.height_ - this.labelText.height) / 2);

    const x = this.width_ - SWITCH_WIDTH;
    const y = (this.height_ - SWITCH_HEIGHT) / 2;
    const r = SWITCH_HEIGHT / 2;
    const knobR = r - 4;

    this.track
      .clear()
      .roundRect(x, y, SWITCH_WIDTH, SWITCH_HEIGHT, r)
      .fill({ color: this.value ? theme.accent : theme.trackBg })
      .stroke({
        width: 1,
        color: this.value ? theme.accent : theme.trackBorder,
        alignment: 0,
      })
      .circle(
        this.value ? x + SWITCH_WIDTH - r : x + r,
        y + r,
        Math.max(4, knobR),
      )
      .fill({ color: this.value ? 0x08120f : theme.textDim });

    this.labelText.style.fill = this.value ? theme.textBright : theme.textDim;
  }
}

/** Vertical gap between stacked toggle rows. */
export const TOGGLE_GAP = metrics.panelPad * 0.45;
