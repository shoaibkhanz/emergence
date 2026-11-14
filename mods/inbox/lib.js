// Sub-agents an agent started itself (`hc run --bg`): they have no tab, so agents() misses them, but a blocked one
// still needs you and a working one is still working. As agents() entries, enough for the inbox's cards and counts.
export const subAgents = (terminals, known) => terminals
  .filter((x) => x.state === "live" && x.parent && (x.program?.agent || x.report) && !known.has(x.address)) // an agent as the graph counts one
  .map((x) => ({ address: x.address, status: x.status === "error" ? "blocked" : x.status, program: x.program, title: x.title || x.name,
    space_name: (x.foreground?.cwd ?? x.cwd ?? "").split("/").filter(Boolean).pop(), sub: true }));

// The sidebar column shared by Spaces, the inbox and Ports (H, measured). Spaces gets the height its rows want while
// the inbox's content still fits, but never under half of what the two share, never under 60px and never leaving the
// inbox under 90px; Ports gets at least what its rows need (portsMin, from mods/ports), plus the slack under the
// inbox's cards, so it sits right below them. Folded, Ports gets nothing. Before the first measure (H 0): Spaces at
// most 285px.
export const INBOX_MIN = 90, SPACES_MIN = 60, SPACES_FIRST = 285;
export function splitColumn({ H, spacesWant, need, portsMin, collapsed }) {
  const min = collapsed ? 0 : portsMin, pool = H - min;
  const spaces = Math.round(H ? Math.max(SPACES_MIN, Math.min(spacesWant, pool - INBOX_MIN, Math.max(pool - need, pool / 2))) : Math.min(spacesWant, SPACES_FIRST));
  const ports = collapsed ? 0 : H ? Math.max(min, Math.round(H - spaces - Math.max(need, INBOX_MIN))) : min;
  return { spaces, ports };
}
