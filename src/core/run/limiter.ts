/**
 * Request limiter: a token bucket for requests per minute plus a concurrency cap.
 * Also tracks input tokens per rolling second (TypeSafe documents 250k input tokens/s; we stay far below).
 * Clock and sleep are injectable for tests.
 */
import { AbortedError } from "../jev/errors.ts";

export interface LimiterConfig {
  requestsPerMinute: number;
  /** Bucket size. Default 1 (strict spacing). */
  burst?: number;
  concurrency: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Limiter {
  /**
   * Resolves when a request may start. Call the returned function when it finishes.
   * With a signal, a wait that is aborted gives up its place and rejects with AbortedError.
   */
  acquire(signal?: AbortSignal): Promise<() => void>;
  recordTokens(n: number): void;
  tokensLastSecond(): number;
  readonly inFlight: number;
}

export function createLimiter(cfg: LimiterConfig): Limiter {
  const now = cfg.now ?? (() => Date.now());
  const sleep = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const burst = Math.max(1, cfg.burst ?? 1);
  const ratePerMs = cfg.requestsPerMinute / 60_000;
  let tokens = burst;
  let last = now();
  let inFlight = 0;
  const slotWaiters: (() => void)[] = [];
  let chain: Promise<void> = Promise.resolve();
  const tokenLog: { t: number; n: number }[] = [];

  function refill() {
    const t = now();
    tokens = Math.min(burst, tokens + (t - last) * ratePerMs);
    last = t;
  }

  async function takeToken() {
    for (;;) {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.ceil((1 - tokens) / ratePerMs));
    }
  }

  async function takeSlot(signal?: AbortSignal) {
    if (signal?.aborted) throw new AbortedError();
    if (inFlight < cfg.concurrency) {
      inFlight++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = slotWaiters.indexOf(waiter);
        if (i >= 0) slotWaiters.splice(i, 1);
        reject(new AbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      slotWaiters.push(waiter);
    });
    inFlight++;
  }

  function releaseSlot() {
    inFlight--;
    const next = slotWaiters.shift();
    if (next) next();
  }

  return {
    get inFlight() {
      return inFlight;
    },
    async acquire(signal?: AbortSignal) {
      await takeSlot(signal);
      // Serialize token taking so waiters start in order.
      const mine = chain.then(takeToken);
      chain = mine.catch(() => undefined);
      await mine;
      if (signal?.aborted) {
        releaseSlot();
        throw new AbortedError();
      }
      let released = false;
      return () => {
        if (!released) {
          released = true;
          releaseSlot();
        }
      };
    },
    recordTokens(n: number) {
      tokenLog.push({ t: now(), n });
    },
    tokensLastSecond() {
      const t = now();
      while (tokenLog.length && tokenLog[0]!.t < t - 1000) tokenLog.shift();
      return tokenLog.reduce((a, e) => a + e.n, 0);
    },
  };
}
