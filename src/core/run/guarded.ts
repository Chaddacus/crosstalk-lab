/**
 * Wrap a backend with the limiter and the budget: reserve an estimate, wait for a slot, settle the real cost.
 *
 * Settling rules (the spend cap must never undercount a request that was sent):
 *  - success with a reported or list-price cost: settle that cost;
 *  - success with an estimated cost (the response had no usage): settle max(reservation, estimate);
 *  - failure after the upstream answered 2xx (the error is marked `billed`): settle the best known cost,
 *    or the reservation when the body gave none;
 *  - any other failure (nothing was billed: refused, 4xx, 5xx, timeout, abort): release the reservation.
 */
import { AbortedError } from "../jev/errors.ts";
import { requestCanonical } from "../jev/request-hash.ts";
import type { DecideOptions, DecideRequest, DecideResult, DecisionBackend } from "../jev/types.ts";
import { type Budget, estimateUsd } from "./budget.ts";
import type { Limiter } from "./limiter.ts";

export interface GuardedCost {
  costUsd: number;
  inputTokens: number;
  /** True when the cost is an estimate (no usage in the response). */
  estimated?: boolean;
}

export async function guarded<T>(
  requestChars: number,
  limiter: Limiter,
  budget: Budget,
  call: () => Promise<{ value: T } & GuardedCost>,
  signal?: AbortSignal,
): Promise<T> {
  const reservation = budget.reserve(estimateUsd(requestChars));
  let release: (() => void) | null = null;
  try {
    release = await limiter.acquire(signal);
    if (signal?.aborted) throw new AbortedError();
    const r = await call();
    budget.settle(reservation, r.estimated ? Math.max(reservation.usd, r.costUsd) : r.costUsd);
    limiter.recordTokens(r.inputTokens);
    return r.value;
  } catch (e) {
    const b = e as { billed?: boolean; billedUsd?: number | null };
    if (b && b.billed) budget.settle(reservation, typeof b.billedUsd === "number" && b.billedUsd >= 0 ? b.billedUsd : reservation.usd);
    else budget.release(reservation);
    throw e;
  } finally {
    release?.();
  }
}

export function withGuards(backend: DecisionBackend, limiter: Limiter, budget: Budget): DecisionBackend {
  return {
    kind: backend.kind,
    label: backend.label,
    decide(req: DecideRequest, opts?: DecideOptions): Promise<DecideResult> {
      return guarded(
        requestCanonical(req).length,
        limiter,
        budget,
        async () => {
          const res = await backend.decide(req, opts);
          return { value: res, costUsd: res.usage.costUsd ?? 0, inputTokens: res.usage.inputTokens, estimated: res.usage.costSource === "estimated" || res.usage.costUsd === null };
        },
        opts?.signal,
      );
    },
  };
}
