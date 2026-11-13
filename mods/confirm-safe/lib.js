// "/Users/me/code/x/.wt/feat-y" -> "~/code/x/.wt/feat-y"; past `max` characters, the first folder … the last two.
export function shortPath(path, home, max = 46) {
  const p = home && path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
  const parts = p.split("/");
  return p.length <= max || parts.length <= 4 ? p : [parts[0], parts[1], "…", ...parts.slice(-2)].join("/");
}
