import { Application } from "pixi.js";
import { AudioEngine } from "../audio/engine";
import { loadConfig } from "../config";
import { InstrumentState } from "../state";
import { metrics, theme } from "../theme";
import { GridView } from "../ui/GridView";
import { Overlay } from "../ui/Overlay";
import { SettingsPanel } from "../ui/SettingsPanel";

/** Boot the PixiJS instrument into `root`. */
export async function mount(root: HTMLElement): Promise<void> {
  root.classList.add("instrument");

  const container = document.createElement("div");
  root.appendChild(container);

  const config = loadConfig();
  const app = new Application();

  await app.init({
    background: theme.bg,
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);

  app.stage.eventMode = "static";

  const state = new InstrumentState(config);
  const engine = new AudioEngine(config);

  const settings = new SettingsPanel(state);
  const grid = new GridView(state, engine, config);
  const overlay = new Overlay();

  app.stage.addChild(settings, grid, overlay);

  let audioUnlocked = false;
  overlay.onStart = async () => {
    await engine.start();
    audioUnlocked = true;
    updateOverlay();
  };

  function isPortrait() {
    return app.screen.height > app.screen.width;
  }

  function updateOverlay() {
    if (isPortrait()) overlay.setMode("rotate");
    else if (!audioUnlocked) overlay.setMode("start");
    else overlay.setMode("hidden");
  }

  function layout() {
    const w = app.screen.width;
    const h = app.screen.height;
    const settingsWidth = Math.round(
      Math.max(
        metrics.settingsMin,
        Math.min(metrics.settingsMax, w * metrics.settingsFraction),
      ),
    );

    settings.position.set(0, 0);
    settings.resize(settingsWidth, h);

    grid.position.set(settingsWidth, 0);
    grid.resize(w - settingsWidth, h);

    overlay.resize(w, h);
    updateOverlay();
  }

  app.renderer.on("resize", layout);
  layout();

  app.ticker.add((ticker) => grid.update(ticker.deltaMS));

  // "h" toggles the debug overlay showing each cell's chamfered touch area.
  window.addEventListener("keydown", (e) => {
    if (e.key === "h" || e.key === "H") {
      state.debugHitArea = !state.debugHitArea;
    }
  });

  // Losing focus mid-gesture would otherwise leave notes hanging.
  window.addEventListener("blur", () => {
    grid.releaseAll();
    engine.releaseAll();
  });
}
