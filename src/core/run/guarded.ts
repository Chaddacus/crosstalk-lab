/** Wrap a backend with the limiter and the budget: reserve an estimate, wait for a slot, settle the real cost. */
import { requestCanonical } from "../jev/request-hash.ts";
import type { DecideOptions, DecideRequest, DecideResult, DecisionBackend } from "../jev/types.ts";
import { type Budget, estimateUsd } from "./budget.ts";
import type { Limiter } from "./limiter.ts";

export async function guarded<T>(
  requestChars: number,
  limiter: Limiter,
  budget: Budget,
  call: () => Promise<{ value: T; costUsd: number; inputTokens: number }>,
): Promise<T> {
  const reservation = budget.reserve(estimateUsd(requestChars));
  const release = await limiter.acquire();
  try {
    const r = await call();
    budget.settle(reservation, r.costUsd);
    limiter.recordTokens(r.inputTokens);
    return r.value;
  } catch (e) {
    budget.release(reservation);
    throw e;
  } finally {
    release();
  }
}

export function withGuards(backend: DecisionBackend, limiter: Limiter, budget: Budget): DecisionBackend {
  return {
    kind: backend.kind,
    label: backend.label,
    decide(req: DecideRequest, opts?: DecideOptions): Promise<DecideResult> {
      return guarded(requestCanonical(req).length, limiter, budget, async () => {
        const res = await backend.decide(req, opts);
        return { value: res, costUsd: res.usage.costUsd ?? 0, inputTokens: res.usage.inputTokens };
      });
    },
  };
}
