// Every Emergence shortcut, grouped. `action`: read from keys.json (so a rebind shows); `keys`: handled inside a mod.

export const GROUPS = [
  ["Panels", [
    [{ action: "tabs-plus.graph" }, "Agents: every agent, its worktree and PR"],
    [{ action: "tabs-plus.prs" }, "PRs: review pull requests and compare branches"],
    [{ action: "tabs-plus.skills" }, "Library: every skill and plugin"],
    [{ action: "tabs-plus.usage" }, "Usage: what your agents cost and deliver"],
    [{ keys: "↑ ↓ · ← → · ↵ · Esc" }, "In a panel: step through · switch tabs · open · step back, then to the terminal"],
  ]],
  ["Sidebar", [
    [{ action: "tabs-plus.rail" }, "Open it with the keyboard in Spaces; in it, fold it"],
    [{ action: "tabs-plus.thinner" }, "One size thinner: open → rail → dots"],
    [{ action: "tabs-plus.attention" }, "The keyboard into the Inbox"],
    [{ keys: "↑ ↓ · ↵" }, "Move · open the space or worktree, or go to the agent"],
    [{ keys: "← →" }, "On a repo: fold or unfold it"],
    [{ keys: "←" }, "On a worktree: delete it (asks first; also on right-click)"],
    [{ keys: "→" }, "On a worktree: archive it (asks first; also on right-click)"],
    [{ action: "inbox.focus", section: "mod:spaces-plus" }, "Spaces → Inbox"],
    [{ action: "ports.focus" }, "Inbox → Ports"],
    [{ action: "spaces-plus.focus" }, "Inbox → Spaces"],
    [{ action: "inbox.focus", section: "mod:ports" }, "Ports → Inbox"],
    [{ keys: "↵ · ←" }, "On a port: its card · stop it (asks first)"],
    [{ action: "spaces-plus.back", keys: "Esc" }, "Back to the terminal you came from"],
  ]],
  ["PRs", [
    [{ keys: "⌘F" }, "Find across the PR"],
    [{ keys: "[ ]" }, "Previous · next commit"],
  ]],
  ["Jump and worktrees", [
    [{ action: "mod.open:jump" }, "Jump: every session and worktree"],
    [{ action: "tabs-plus.worktrees" }, "Every worktree of the repo you're in"],
    [{ action: "mod.open:emergence-keys" }, "These keys"],
  ]],
  ["Panes", [
    [{ action: ["nav-keys.left", "nav-keys.down", "nav-keys.up", "nav-keys.right"] }, "Move between panes and (n)vim splits (nav-keys, optional)"],
  ]],
];

const GLYPH = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };

// "cmd-shift-a" -> "⌘⇧A", "cmd-shift-/" -> "⌘⇧/".
export const glyphs = (k) => k.split("-").map((p) => GLYPH[p] ?? (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join("");

// [group, [[keys text, what], ...]] for the bindings (keys()); an unbound action shows "—"; filtered by text.
export function rows(bindings, filter = "") {
  // A row may name the section its binding lives in: inbox.focus is ctrl-j in Spaces and ctrl-k in Ports.
  const keyOf = (a, section) => bindings.find((b) => b.action === a && (!section || b.section === section))?.keys;
  const f = filter.trim().toLowerCase();
  return GROUPS.map(([name, list]) => [name, list.map(([k, what]) => {
    const actions = [k.action ?? []].flat(), bound = actions.map((a) => keyOf(a, k.section)).filter(Boolean);
    const text = [bound.length ? bound.map(glyphs).join(" ") : actions.length && !k.keys ? "—" : "", k.keys ?? ""].filter(Boolean).join(" · ");
    return [text, what];
  }).filter(([text, what]) => !f || `${text} ${what}`.toLowerCase().includes(f))]).filter(([, list]) => list.length);
}
