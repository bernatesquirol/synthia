import { Container, Graphics, Rectangle, Text, TextStyle } from "pixi.js";
import { fonts, theme } from "../theme";

export type OverlayMode = "hidden" | "start" | "rotate";

/**
 * Full-screen gate. Browsers require a gesture before audio can start, and the
 * instrument assumes landscape, so both blockers share one surface.
 */
export class Overlay extends Container {
  private bg = new Graphics();
  private title: Text;
  private subtitle: Text;
  private mode: OverlayMode = "start";

  private w = 0;
  private h = 0;

  /** Invoked when the user taps while the "start" gate is showing. */
  onStart: () => void = () => {};

  constructor() {
    super();
    this.addChild(this.bg);

    this.title = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 34,
        fontWeight: "700",
        fill: theme.textBright,
        align: "center",
      }),
    });
    this.subtitle = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 15,
        letterSpacing: 1.2,
        fill: theme.textDim,
        align: "center",
      }),
    });
    this.title.anchor.set(0.5);
    this.subtitle.anchor.set(0.5);
    this.addChild(this.title, this.subtitle);

    this.eventMode = "static";
    this.on("pointerdown", () => {
      if (this.mode === "start") this.onStart();
    });
  }

  setMode(mode: OverlayMode): void {
    this.mode = mode;
    this.visible = mode !== "hidden";
    this.eventMode = mode === "hidden" ? "none" : "static";
    if (mode === "start") {
      this.title.text = "Tonnetz Synth";
      this.subtitle.text = "TAP ANYWHERE TO ENABLE SOUND";
    } else if (mode === "rotate") {
      this.title.text = "Rotate your device";
      this.subtitle.text = "THIS INSTRUMENT IS PLAYED IN LANDSCAPE";
    }
    this.layout();
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.hitArea = new Rectangle(0, 0, width, height);
    this.layout();
  }

  private layout(): void {
    if (this.w <= 0) return;
    this.bg
      .clear()
      .rect(0, 0, this.w, this.h)
      .fill({ color: theme.bg, alpha: 0.93 });
    this.title.position.set(this.w / 2, this.h / 2 - 18);
    this.subtitle.position.set(this.w / 2, this.h / 2 + 26);
  }
}
