/**
 * Spend cap. Before a request, reserve an estimate (characters ÷ 3 tokens, rounded up, at list price).
 * After the response, settle with the real cost. Refuse new requests when the cap would be passed.
 */
import { BudgetExceeded } from "../jev/errors.ts";
import { JEV_USD_PER_INPUT_TOKEN } from "../jev/types.ts";

export interface Reservation {
  id: number;
  usd: number;
}

export function estimateUsd(requestChars: number): number {
  return Math.ceil(requestChars / 3) * JEV_USD_PER_INPUT_TOKEN;
}

export class Budget {
  readonly capUsd: number;
  spentUsd = 0;
  private reserved = new Map<number, number>();
  private nextId = 1;

  constructor(capUsd: number) {
    if (!(capUsd >= 0)) throw new Error("budget cap must be >= 0");
    this.capUsd = capUsd;
  }

  get reservedUsd(): number {
    let s = 0;
    for (const v of this.reserved.values()) s += v;
    return s;
  }

  reserve(usd: number): Reservation {
    if (this.spentUsd + this.reservedUsd + usd > this.capUsd + 1e-12) {
      throw new BudgetExceeded(
        `budget cap $${this.capUsd.toFixed(4)} would be passed (spent $${this.spentUsd.toFixed(6)}, reserved $${this.reservedUsd.toFixed(6)}, next ~$${usd.toFixed(6)})`,
      );
    }
    const r = { id: this.nextId++, usd };
    this.reserved.set(r.id, usd);
    return r;
  }

  settle(r: Reservation, actualUsd: number): void {
    this.reserved.delete(r.id);
    this.spentUsd += actualUsd;
  }

  release(r: Reservation): void {
    this.reserved.delete(r.id);
  }
}
