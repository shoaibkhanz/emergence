// Retry a flaky async call (network, rate limits) with exponential backoff and jitter.
export async function retry(fn, { tries = 4, base = 250, max = 4000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries || !isTransient(err)) throw err;
      const wait = Math.min(max, base * 2 ** (i - 1));
      await sleep(wait / 2 + (Math.random() * wait) / 2);
    }
  }
}

const TRANSIENT = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);

// Worth another try: a dropped connection, a 5xx, or being rate limited.
export const isTransient = (err) => TRANSIENT.has(err?.code) || err?.status >= 500 || err?.status === 429;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
