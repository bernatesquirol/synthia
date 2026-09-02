/** Central palette + metrics so the two panels stay visually coherent. */
export const theme = {
  bg: 0x0b0d11,

  panelBg: 0x12151c,
  panelBorder: 0x222836,

  trackBg: 0x1a1f29,
  trackBorder: 0x2a3140,

  panZoneBg: 0x0d1016,
  panZoneBorder: 0x2a3140,

  cellBg: 0x161a22,
  cellBorder: 0x242b39,
  cellText: 0x66717f,

  chordBg: 0x17323a,
  chordBorder: 0x2fbfa8,
  chordText: 0xa9f0e4,

  rootBg: 0x1f4d52,
  rootBorder: 0x6ff0d8,
  rootText: 0xdffff8,

  pressedBg: 0xffd166,
  pressedBorder: 0xfff2cc,
  pressedText: 0x1a1206,

  outText: 0x2c323d,

  accent: 0x2fbfa8,
  textDim: 0x6b7686,
  textBright: 0xe8edf5,
} as const;

export const metrics = {
  /** Width of the settings panel as a fraction of the viewport. */
  settingsFraction: 0.34,
  settingsMin: 250,
  settingsMax: 430,
  panelPad: 18,
  radius: 10,
} as const;

export const fonts = {
  ui: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;
