import qs from "qs";

/**
 * Every tunable in one place. Any leaf can be overridden from the URL query
 * string using dotted paths, e.g.
 *
 *   ?play.playInactiveOnDrag=true&grid.panSpeed=900&chord.root=F#
 *
 * Booleans also accept a bare flag (`?grid.debugHitArea`) and on/off/yes/no.
 * Unknown keys and unparseable values are warned about and ignored, so a
 * fat-fingered URL degrades to the defaults instead of breaking the app.
 */
export const DEFAULT_CONFIG = {
  play: {
    /**
     * Whether a cell outside the selected chord sounds when a drag reaches it.
     * With this off, dragging holds the last chord tone until the finger
     * arrives at another one, so a glide arpeggiates the chord.
     */
    playInactiveOnDrag: false,
    /** Whether a cell outside the selected chord sounds on the initial press. */
    playInactiveOnClick: true,
  },
  chord: {
    /** Pitch class name, e.g. "C", "F#". */
    root: "C",
    /** Quality label as shown on the selector, e.g. "maj", "m7". */
    quality: "maj",
  },
  grid: {
    /** Key of `LAYOUTS` in music/layout.ts. */
    layout: "tonnetz",
    /** Half the diamond's diagonal in px; 0 fits it to the viewport. */
    halfDiag: 0,
    /** Multiplier on the cell size. Above 1 zooms in, below 1 zooms out. */
    zoom: 1,
    /** Gap between drawn diamonds, in px. */
    gap: 3,
    /** Corner chamfer of the touch area as a fraction of cell side (0..0.5). */
    cornerCut: 0.26,
    /**
     * "visible": a band around the edge is reserved for panning. The lattice
     * still draws underneath it, veiled, so you can see the notes you are
     * panning towards but cannot play them. "integrated": no band; the grid's
     * own margins pan while still playing (uses `edgeMargin`).
     */
    panZone: "visible",
    /** Width of the visible pan zone band, in px. */
    panZoneSize: 48,
    /** How much the pan zone veils the grid beneath it, 0..1. */
    panZoneOpacity: 0.62,
    /** Auto-pan margin inside the grid, in px. Only used when integrated. */
    edgeMargin: 64,
    /** Peak auto-pan speed in px/second. */
    panSpeed: 620,
    /** Draw the chamfered touch areas. Toggle at runtime with "h". */
    debugHitArea: false,
  },
  audio: {
    /** Synth output level in dB. */
    volume: -8,
    /** Oscillator shape: sine, triangle, square or sawtooth. */
    waveform: "triangle",
    /** Reverb send, 0..1. */
    reverbWet: 0.22,
    /** Maximum simultaneous voices. */
    maxPolyphony: 24,
  },
};

export type AppConfig = typeof DEFAULT_CONFIG;

type Mutable = Record<string, unknown>;

/** Parse the query string over the defaults. */
export function loadConfig(search: string = window.location.search): AppConfig {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
  const overrides = qs.parse(search, {
    ignoreQueryPrefix: true,
    allowDots: true,
    depth: 4,
  }) as Mutable;

  applyOverrides(config as unknown as Mutable, overrides, []);
  return config;
}

function applyOverrides(
  target: Mutable,
  overrides: Mutable,
  path: string[],
): void {
  for (const [key, raw] of Object.entries(overrides)) {
    const here = [...path, key].join(".");

    if (!(key in target)) {
      warn(`unknown setting "${here}"`);
      continue;
    }

    const current = target[key];
    if (isGroup(current)) {
      if (!isGroup(raw)) {
        warn(`"${here}" is a group of settings, not a single value`);
        continue;
      }
      applyOverrides(current, raw, [...path, key]);
      continue;
    }

    if (typeof raw !== "string") {
      warn(`"${here}" expects a single value`);
      continue;
    }

    const coerced = coerce(current, raw);
    if (coerced === undefined) {
      warn(`"${here}" cannot be ${JSON.stringify(raw)}`);
      continue;
    }
    target[key] = coerced;
  }
}

/** Coerce a query-string value to the type of the default it replaces. */
function coerce(current: unknown, raw: string): unknown {
  if (typeof current === "boolean") {
    const v = raw.trim().toLowerCase();
    // A bare `?grid.debugHitArea` arrives as an empty string.
    if (v === "" || v === "1" || v === "true" || v === "yes" || v === "on") {
      return true;
    }
    if (v === "0" || v === "false" || v === "no" || v === "off") return false;
    return undefined;
  }
  if (typeof current === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof current === "string") return raw;
  return undefined;
}

function isGroup(value: unknown): value is Mutable {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function warn(message: string): void {
  console.warn(`[config] ${message}; using the default`);
}
