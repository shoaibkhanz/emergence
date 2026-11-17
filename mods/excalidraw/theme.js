// herdr-mods: the Excalidraw mod follows Herdr's theme. A dark theme gets a black canvas, tool panels in the theme's
// own colours, and the drawing seen as Excalidraw's dark mode sees it: every colour through invert(93%) and
// hue-rotate(180deg), on screen only (the file keeps the colours it was drawn in, so it reads right anywhere).
// A light theme keeps Excalidraw's look: a white canvas and its own light panels.

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex) => { const [r, g, b] = rgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
export const isDark = (t) => /^#[0-9a-f]{6}/i.test(t?.background ?? "") && lum(t.background) < 0.5;

// CSS invert(0.93) then hue-rotate(180deg) (the Filter Effects spec's matrices), as Excalidraw's dark mode.
const HUE180 = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]];
export function darkInk(color) {
  if (!color || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) return color;
  const inv = rgb(color).map((c) => 0.07 * c + 0.93 * (255 - c));
  const out = HUE180.map((row) => Math.round(Math.min(255, Math.max(0, row[0] * inv[0] + row[1] * inv[1] + row[2] * inv[2]))));
  return "#" + out.map((c) => c.toString(16).padStart(2, "0")).join("") + color.slice(7);
}

// What toColor hands the canvas: the colour as drawn, or as dark mode sees it. The editor sets this from the theme
// (and rebuilds its layers when it changes: they hold their colours).
let dark = false;
export const setDark = (on) => { dark = on; };
export const ink = (color) => (dark ? darkInk(color) : color);

export const canvasColor = (t) => (isDark(t) ? "#000000" : "#ffffff");
export const LIGHT_UI = { surface: "#ffffff", border: "#e9ecef", swatchBorder: "#ced4da", foreground: "#1e1e1e", muted: "#868e96", selected: "#e0dfff", hover: "#f1f0ff" };
export const uiColors = (t) => (isDark(t)
  ? { surface: t.popover, border: t.border, swatchBorder: t.input, foreground: t.foreground, muted: t.muted, selected: t.selected, hover: t.hover }
  : LIGHT_UI);
