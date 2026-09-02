import {
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
} from "pixi.js";
import { fonts, metrics, theme } from "../theme";

export interface StepperOptions {
  label: string;
  /** Called with -1 or +1 when a button is tapped. */
  onStep: (direction: number) => void;
}

const BTN = 26;
const VALUE_W = 48;
const GROUP_W = BTN * 2 + VALUE_W;
/** How far a press may travel and still count as a tap rather than a scroll. */
const TAP_SLOP = 7;

/**
 * A label with minus/plus buttons and a value readout. Like `Toggle`, it uses
 * slop-checked taps rather than claiming the pointer, so a drag starting on the
 * row still scrolls an enclosing `ScrollView`.
 */
export class Stepper extends Container {
  private labelText: Text;
  private valueText: Text;
  private buttons = new Graphics();

  private onStep: (direction: number) => void;
  private canDec = true;
  private canInc = true;

  private width_ = 0;
  private height_ = BTN;
  private downId: number | null = null;
  private downX = 0;
  private downY = 0;

  constructor(opts: StepperOptions) {
    super();
    this.onStep = opts.onStep;

    this.labelText = new Text({
      text: opts.label,
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 12,
        fill: theme.textDim,
        wordWrap: true,
        wordWrapWidth: 160,
        lineHeight: 15,
      }),
    });
    this.valueText = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 12,
        fontWeight: "600",
        fill: theme.textBright,
        align: "center",
      }),
    });
    this.valueText.anchor.set(0.5);
    this.addChild(this.labelText, this.buttons, this.valueText);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointerdown", this.onDown, this);
    this.on("pointerup", this.onUp, this);
    this.on("pointerupoutside", this.onCancel, this);
    this.on("pointercancel", this.onCancel, this);
  }

  get rowHeight(): number {
    return this.height_;
  }

  resize(width: number): void {
    this.width_ = width;
    this.labelText.style.wordWrapWidth = Math.max(40, width - GROUP_W - 14);
    this.height_ = Math.max(BTN, this.labelText.height);
    this.hitArea = new Rectangle(0, 0, width, this.height_);
    this.redraw();
  }

  /** Update the readout and whether either direction is still available. */
  setState(text: string, canDec: boolean, canInc: boolean): void {
    this.valueText.text = text;
    this.canDec = canDec;
    this.canInc = canInc;
    this.redraw();
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
    if (travelled > TAP_SLOP) return;

    const x = e.getLocalPosition(this).x;
    const decX = this.width_ - GROUP_W;
    if (x >= decX && x <= decX + BTN) {
      if (this.canDec) this.onStep(-1);
    } else if (x >= this.width_ - BTN) {
      if (this.canInc) this.onStep(1);
    }
  }

  private onCancel(e: FederatedPointerEvent): void {
    if (this.downId === e.pointerId) this.downId = null;
  }

  private redraw(): void {
    if (this.width_ <= 0) return;

    this.labelText.position.set(0, (this.height_ - this.labelText.height) / 2);

    const y = (this.height_ - BTN) / 2;
    const decX = this.width_ - GROUP_W;
    const incX = this.width_ - BTN;
    const g = this.buttons.clear();

    for (const [x, enabled] of [
      [decX, this.canDec],
      [incX, this.canInc],
    ] as [number, boolean][]) {
      g.roundRect(x, y, BTN, BTN, metrics.radius - 3)
        .fill({ color: theme.trackBg })
        .stroke({
          width: 1,
          color: theme.trackBorder,
          alignment: 0,
        });
      const cx = x + BTN / 2;
      const cy = y + BTN / 2;
      const arm = 6;
      g.moveTo(cx - arm, cy).lineTo(cx + arm, cy);
      if (x === incX) g.moveTo(cx, cy - arm).lineTo(cx, cy + arm);
      g.stroke({
        width: 1.8,
        color: enabled ? theme.accent : theme.trackBorder,
        cap: "round",
      });
    }

    this.valueText.position.set(decX + BTN + VALUE_W / 2, this.height_ / 2);
  }
}
