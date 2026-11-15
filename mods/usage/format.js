// Usage's constants and formatters, shared by main.js and its view parts.

// Herdr's program icons (omp's ships with the inbox) and one hue per harness from the Okabe–Ito palette:
// colour-blind safe, far apart, readable in light and dark themes. omp and Claude get the most distant pair.
export const HARNESS = {
  omp: { name: "omp", icon: "mods/inbox/omp.svg", tint: false, color: "#56b4e9" }, // sky blue
  claude: { name: "Claude Code", icon: "icons/claude.svg", tint: false, color: "#e69f00" }, // orange
  codex: { name: "Codex", icon: "icons/codex.svg", tint: false, color: "#009e73" }, // bluish green
  opencode: { name: "OpenCode", icon: "icons/opencode.svg", tint: true, color: "#cc79a7" }, // reddish purple
  pi: { name: "pi", icon: "icons/pi.svg", tint: true, color: "#f0e442" }, // yellow
};
export const ORDER = Object.keys(HARNESS);
export const EFFORT = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "default"];
// Effort: one clearly different hue per level, still reading cool (less) to hot (more): blue, green, yellow,
// orange, red. Neighbours never share a hue, so every level is told apart at a glance.
export const EFFORT_INK = { off: "#9ca3af", minimal: "#93c5fd", low: "#3b82f6", medium: "#10b981", high: "#eab308", xhigh: "#f97316", max: "#dc2626", default: "#4b5563" };
export const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const short = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n ?? 0)));
export const pct = (x) => (x == null ? "–" : x > 0.99 && x < 1 ? ">99%" : `${Math.round(x * 100)}%`);
export const date = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MONTH[d.getMonth()]}`; };
export const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };
export const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// "2026-11-03" -> local midnight, or null while it isn't a real date yet.
export const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim()); if (!m) return null; const d = new Date(+m[1], m[2] - 1, +m[3]); return d.getDate() === +m[3] ? d.getTime() : null; };
export const LEVEL = [0, 0.3, 0.5, 0.75, 1];
// Token kinds (ColorBrewer Set2: apart from the harness hues): what an agent's spend is made of.
export const MIX = [["tin", "Fresh input", "#8da0cb"], ["tcw", "Cache write", "#fc8d62"], ["tcr", "Cache read", "#66c2a5"], ["tout", "Output", "#e78ac3"]];
export const usd = (x) => (x == null ? "–" : x >= 100 ? `$${Math.round(x)}` : `$${x.toFixed(2)}`);
export const num = (x) => (x == null ? "–" : x >= 10 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(1));
export const mins = (m) => (m < 1 ? "<1m" : m < 60 ? `${Math.round(m)}m` : `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`);
export const hh = (h) => `${String(h % 24).padStart(2, "0")}:00`;
