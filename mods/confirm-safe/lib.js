// "/Users/me/code/x/.wt/feat-y" -> "~/code/x/.wt/feat-y"; past `max` characters, the first folder … the last two.
export function shortPath(path, home, max = 46) {
  const p = home && path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
  const parts = p.split("/");
  return p.length <= max || parts.length <= 4 ? p : [parts[0], parts[1], "…", ...parts.slice(-2)].join("/");
}

// The selected button after a key, of `n` in a row: ←/→ move and stop at the ends, Tab wraps; other keys leave it.
export function step(sel, key, n) {
  if (key === "left") return Math.max(0, sel - 1);
  if (key === "right") return Math.min(n - 1, sel + 1);
  if (key === "tab") return (sel + 1) % n;
  return sel;
}

// Emergence's dialog frame (RECIPE "Dialogs"); mods/dialogs.test.js holds every dialog's copy to it.
export const DIALOG = { pad: 24, gap: 16, title: 22, radius: 10, button: 32 };
