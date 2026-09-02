import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { InstrumentState } from "../state";
import { fonts, metrics, theme } from "../theme";
import { GridSettingsView } from "./GridSettingsView";
import { IconButton } from "./IconButton";
import { ScrollView } from "./ScrollView";
import { StaticSettingsView } from "./StaticSettingsView";

const HEADER_HEIGHT = 34;

type PanelTab = "grid" | "static";

/**
 * Left-hand panel. Two views share the space: the grid settings that change
 * while playing, and the static setup reached from the header button. Each
 * scrolls independently, since a phone in landscape is vertically tight.
 */
export class SettingsPanel extends Container {
  private bg = new Graphics();
  private title: Text;
  private button: IconButton;

  private gridScroll = new ScrollView();
  private staticScroll = new ScrollView();
  private gridView: GridSettingsView;
  private staticView: StaticSettingsView;

  private tab: PanelTab = "grid";
  private width_ = 0;
  private height_ = 0;

  constructor(state: InstrumentState) {
    super();
    this.addChild(this.bg);

    this.title = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: fonts.ui,
        fontSize: 13,
        fontWeight: "700",
        letterSpacing: 2.2,
        fill: theme.accent,
      }),
    });
    this.addChild(this.title);

    this.button = new IconButton("settings", HEADER_HEIGHT - 6, () =>
      this.setTab(this.tab === "grid" ? "static" : "grid"),
    );
    this.addChild(this.button);

    this.gridView = new GridSettingsView(state);
    this.staticView = new StaticSettingsView(state);
    this.gridScroll.content.addChild(this.gridView);
    this.staticScroll.content.addChild(this.staticView);
    this.addChild(this.gridScroll, this.staticScroll);

    this.applyTab();
  }

  setTab(tab: PanelTab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.applyTab();
    this.layoutBody();
  }

  resize(width: number, height: number): void {
    this.width_ = width;
    this.height_ = height;

    const pad = metrics.panelPad;

    this.bg
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: theme.panelBg })
      .rect(width - 1, 0, 1, height)
      .fill({ color: theme.panelBorder });

    this.title.position.set(pad, pad + 5);
    this.button.position.set(width - pad - (HEADER_HEIGHT - 6), pad);

    this.layoutBody();
  }

  private layoutBody(): void {
    if (this.width_ <= 0) return;

    const pad = metrics.panelPad;
    const top = pad + HEADER_HEIGHT + 8;
    const bodyH = Math.max(40, this.height_ - top - pad);
    // Leave room for the scrollbar without letting content sit under it.
    const inner = Math.max(40, this.width_ - pad * 2 - 6);

    for (const scroll of [this.gridScroll, this.staticScroll]) {
      scroll.position.set(0, top);
      scroll.resize(this.width_, bodyH);
    }
    this.gridView.position.set(pad, 0);
    this.staticView.position.set(pad, 0);

    // Only the visible view is measured; the other is laid out when shown.
    if (this.tab === "grid") {
      this.gridScroll.setContentHeight(this.gridView.layout(inner, bodyH));
    } else {
      this.staticScroll.setContentHeight(this.staticView.layout(inner));
    }
  }

  private applyTab(): void {
    const isGrid = this.tab === "grid";
    this.gridScroll.visible = isGrid;
    this.staticScroll.visible = !isGrid;
    this.gridScroll.eventMode = isGrid ? "static" : "none";
    this.staticScroll.eventMode = isGrid ? "none" : "static";
    this.title.text = isGrid ? "TONNETZ SYNTH" : "SETTINGS";
    this.button.setIcon(isGrid ? "settings" : "close");
  }
}
