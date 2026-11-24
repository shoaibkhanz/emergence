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
// Side chats (mods/side-chats, the last section, after Ports) is taken out first, all of what it wants (sideWant); a long
// inbox never squeezes it (the cards scroll). A column that can't hold Spaces' 60, the inbox's 90 and Ports' minimum
// besides shrinks it to what's left, down to nothing (its list scrolls): it never pushes a section past its floor.
export const INBOX_MIN = 90, SPACES_MIN = 60, SPACES_FIRST = 285;
// A section the person dragged (sized: shared sidebar.sized, {spaces?, ports?, "side-chats"?: px}) keeps that size in
// place of its want, as far as the column holds it with Spaces' 60 and the inbox's 90 (the saved size stays, so room
// coming back restores it); a dragged Ports or Side chats may be 0. Folded, dragged sizes don't apply.
export function splitColumn({ H, spacesWant, need, portsMin, sideWant = 0, collapsed, sized = {} }) {
  if (collapsed) sized = {};
  const min = collapsed ? 0 : sized.ports ?? portsMin, sideAsk = sized["side-chats"] ?? sideWant;
  const side = collapsed || !sideAsk ? 0
    : H ? Math.max(0, Math.min(sideAsk, H - SPACES_MIN - INBOX_MIN - min)) : sideAsk;
  const rest = H ? H - side : 0, pool = rest - min;
  const spaces = Math.round(sized.spaces != null ? (rest ? Math.max(SPACES_MIN, Math.min(sized.spaces, pool - INBOX_MIN)) : sized.spaces)
    : rest ? Math.max(SPACES_MIN, Math.min(spacesWant, pool - INBOX_MIN, Math.max(pool - need, pool / 2))) : Math.min(spacesWant, SPACES_FIRST));
  const ports = collapsed ? 0 : sized.ports != null ? (rest ? Math.max(0, Math.min(sized.ports, rest - spaces - INBOX_MIN)) : sized.ports)
    : rest ? Math.max(min, Math.round(rest - spaces - Math.max(need, INBOX_MIN))) : min;
  return { spaces, side, ports };
}

// Which sidebar sections the person dragged (no drag event: told apart from this inbox's own resizes). laid: {id: px}
// as the layout has them; sent: {id: {px, from, applied}}, what the inbox asked for and from what size (main.js
// fitSpaces). A first look adopts what's there (sizes restored at start aren't drags); a send waits until the layout
// moves off `from`, then whatever it moved to is adopted (Herdr trims a request to what fits); after that, a move
// over a pixel (zoom's rounding) is a drag. -> {drags: {id: px}, sent}.
// ponytail: a drag made in the frame between a send and its landing is read as the send's result; the drag's next
// frame is caught.
export function dragsOf(sent, laid) {
  const drags = {}, next = { ...sent };
  for (const [id, px] of Object.entries(laid)) {
    const s = sent[id];
    if (s && !s.applied && px === s.from) continue;
    if (s?.applied && Math.abs(px - s.px) > 1) drags[id] = px;
    if (!s || !s.applied || drags[id] != null) next[id] = { px, from: px, applied: true };
  }
  return { drags, sent: next };
}

// The column's height (splitColumn's H): the inbox's own (ownH, null before its first measure: 0) plus what each other
// section drew (shown, from its shared ".h"; px, what the layout gives it, until it shares one). Null while a resize
// is on its way, a section not yet drawn at the size it was given: the inbox measures itself in the same layout pass
// but the others share theirs a pass later, and counting the stale one sized the column short, then right, forever
// (the sidebar flickered). A pixel's difference is zoom's rounding. `waited`: the same mismatch is still there a while
// later (main.js), so it isn't on its way: the column can't hold what was asked, and what's drawn is the truth.
export function columnHeight(ownH, blocks, waited = false) {
  if (ownH == null) return 0;
  const drawn = blocks.map(({ px = 0, shown }) => (px ? shown ?? px : 0)); // given nothing (folded): nothing, whatever it last shared
  const settled = blocks.every(({ px = 0 }, i) => Math.abs(drawn[i] - px) <= 1);
  return settled || waited ? ownH + drawn.reduce((a, b) => a + b, 0) : null;
}

// The inbox block's parts (px), drawn by main.js with these same numbers. HEADER_H, ROW_H and EMPTY_H are the
// sidebar's section sizes (Ports, Side chats; lib.test.js checks they agree); LIST_PAD is the room under the last card,
// as Spaces leaves under its last row.
export const HEADER_H = 41, ROW_H = 30, EMPTY_H = 32, LIST_PAD = 14, CARD_GAP = 2, CARD_H = 50, FOOT_H = 32,
  SHELF_MAX = 160, SHELF_PAD = 6;

// The height the inbox needs (fitSpaces' need): header, its cards (cardH: one measured, all alike; CARD_H until then)
// or "All caught up", LIST_PAD, then the Settled foot and, open, its shelf (ROW_H a row, scrolling past SHELF_MAX).
export function inboxHeight({ cards, cardH, settled, shelf }) {
  const list = cards ? cards * ((cardH ?? CARD_H) + CARD_GAP) - CARD_GAP : EMPTY_H;
  const foot = settled ? FOOT_H + (shelf ? Math.min(SHELF_MAX, settled * ROW_H) + SHELF_PAD : 0) : 0;
  return HEADER_H + list + LIST_PAD + foot;
}
