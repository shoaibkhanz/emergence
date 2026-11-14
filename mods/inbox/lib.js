// Sub-agents an agent started itself (`hc run --bg`): they have no tab, so agents() misses them, but a blocked one
// still needs you and a working one is still working. As agents() entries, enough for the inbox's cards and counts.
export const subAgents = (terminals, known) => terminals
  .filter((x) => x.state === "live" && x.parent && (x.program?.agent || x.report) && !known.has(x.address)) // an agent as the graph counts one
  .map((x) => ({ address: x.address, status: x.status === "error" ? "blocked" : x.status, program: x.program, title: x.title || x.name,
    space_name: (x.foreground?.cwd ?? x.cwd ?? "").split("/").filter(Boolean).pop(), sub: true }));
