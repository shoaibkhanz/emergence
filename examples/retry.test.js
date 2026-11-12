import { test, expect } from "bun:test";
import { retry, isTransient } from "./retry.js";

test("retries a transient failure, then succeeds", async () => {
  let n = 0;
  const v = await retry(async () => { if (++n < 3) throw { code: "ECONNRESET" }; return "ok"; }, { base: 1 });
  expect([v, n]).toEqual(["ok", 3]);
});

test("gives up at once on a client error", async () => {
  let n = 0;
  await expect(retry(async () => { n++; throw { status: 404 }; }, { base: 1 })).rejects.toEqual({ status: 404 });
  expect(n).toBe(1);
});

test("rate limits and server errors are transient", () => {
  expect([429, 503, 404].map((status) => isTransient({ status }))).toEqual([true, true, false]);
});
