// The bulk delete dialog's decisions, pure (no herdr import) so they can be tested.
// `counts`: key -> files with uncommitted changes; null: git couldn't tell; missing: not known yet.

const s = (n) => (n === 1 ? "" : "s");
// Anything but a known 0 counts as changed: only Delete permanently may lose it.
const changed = (counts, key) => counts[key] !== 0;

// The selected button after a key, of `n` in a row: ←/→ move and stop at the ends, Tab wraps (as confirm-safe).
export function step(sel, key, n) {
  if (key === "left") return Math.max(0, sel - 1);
  if (key === "right") return Math.min(n - 1, sel + 1);
  if (key === "tab") return (sel + 1) % n;
  return sel;
}

// A new set with `key` ticked or unticked.
export function tick(ticked, key) {
  const next = new Set(ticked);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// What a delete does with the ticked items: clean ones go with plain `git worktree remove` (git checks again); changed
// ones are skipped, or, only when `force` (the red choice), go with --force.
export function plan(items, ticked, counts, force) {
  const picked = items.filter((it) => ticked.has(it.key));
  return {
    remove: picked.filter((it) => force || !changed(counts, it.key)).map((it) => ({ ...it, force: force && changed(counts, it.key) })),
    skip: force ? [] : picked.filter((it) => changed(counts, it.key)),
  };
}

// The line under the list.
export function tally(items, ticked, counts) {
  const picked = items.filter((it) => ticked.has(it.key)), d = picked.filter((it) => changed(counts, it.key)).length;
  if (!picked.length) return "Nothing ticked";
  return `${picked.length} ticked` + (d ? ` · ${d} with uncommitted changes` : "");
}

// The confirm's question: `n` ticked, `d` of them with changes.
export function question(n, d) {
  const head = `Delete ${n} worktree${s(n)}?`;
  if (!d) return `${head} Their folders go; their branches stay.`;
  if (d === n) return `${head} ${n === 1 ? "It has" : "All have"} uncommitted changes.`;
  return `${head} ${d} ${d === 1 ? "has" : "have"} uncommitted changes: Delete skips ${d === 1 ? "it" : "them"}.`;
}

// The confirm's buttons, [label, what], left to right, and the selected one: Back, never the red one.
export function choices(n, d) {
  const list = [
    ...(d ? [[`Delete permanently, including ${d} with changes`, "force"]] : []),
    ["Back", "back"],
    ...(n > d ? [[`Delete ${n - d}${d ? " clean" : ""}`, "delete"]] : []),
  ];
  return { list, sel: d ? 1 : 0 };
}
