import { Container, FederatedPointerEvent, Graphics, Rectangle } from "pixi.js";
import { metrics, theme } from "../theme";

export type IconName = "settings" | "close";

/** Small square button drawing one of a couple of vector icons. */
export class IconButton extends Container {
  private bg = new Graphics();
  private icon: IconName;
  private size: number;

  constructor(
    icon: IconName,
    size: number,
    private onTap: () => void,
  ) {
    super();
    this.icon = icon;
    this.size = size;
    this.addChild(this.bg);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(0, 0, size, size);
    // The button is its own gesture; never let it start a scroll drag.
    this.on("pointerdown", (e: FederatedPointerEvent) => e.stopPropagation());
    this.on("pointertap", () => this.onTap());

    this.redraw();
  }

  setIcon(icon: IconName): void {
    if (icon === this.icon) return;
    this.icon = icon;
    this.redraw();
  }

  private redraw(): void {
    const s = this.size;
    const g = this.bg.clear();

    g.roundRect(0, 0, s, s, metrics.radius - 2)
      .fill({ color: theme.trackBg })
      .stroke({ width: 1, color: theme.trackBorder, alignment: 0 });

    const pad = s * 0.28;
    const stroke = { width: 1.8, color: theme.accent, cap: "round" as const };

    if (this.icon === "close") {
      g.moveTo(pad, pad)
        .lineTo(s - pad, s - pad)
        .moveTo(s - pad, pad)
        .lineTo(pad, s - pad)
        .stroke(stroke);
      return;
    }

    // "settings": three sliders with their knobs at staggered positions.
    const rows = [0.3, 0.5, 0.7];
    const knobs = [0.66, 0.38, 0.58];
    for (const r of rows) {
      const y = s * r;
      g.moveTo(pad, y).lineTo(s - pad, y);
    }
    g.stroke(stroke);
    rows.forEach((r, i) => {
      g.circle(pad + (s - pad * 2) * knobs[i], s * r, 2.8);
    });
    g.fill({ color: theme.accent });
  }
}
