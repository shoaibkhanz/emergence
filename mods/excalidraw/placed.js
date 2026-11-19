// herdr-mods: an element with a NaN or missing coordinate (NaN saves as null) poisons every bound taken over it
// (Math.min/max return NaN): the zoom and scroll go NaN, the canvas is blank and each new stroke is saved NaN too.
const ok = Number.isFinite;
export const placed = (e) => ok(e.x) && ok(e.y) && (e.points ?? []).every((p) => ok(p[0]) && ok(p[1]));
