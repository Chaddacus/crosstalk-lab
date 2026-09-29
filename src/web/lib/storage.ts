/**
 * Per-viewer conveniences in localStorage (tab, top-K, threshold) and the browser peek ledger.
 * Storage can be blocked (private windows, previews); every access is wrapped and the app works without it.
 */
import type { LedgerRow } from "../../core/eval/seal.ts";

const PREFIX = "crosstalk:";
const LEDGER_KEY = PREFIX + "ledger:v1";

/** True when localStorage can be written (false in some private windows, previews and blocked-site-data modes). */
export function storageWorks(): boolean {
  try {
    const k = PREFIX + "probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadPref<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v = JSON.parse(raw) as unknown;
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked: preferences are not kept */
  }
}

export function loadLedger(): LedgerRow[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    const rows = raw ? (JSON.parse(raw) as LedgerRow[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Returns false when storage is blocked (the peek is still counted for this page session). */
export function saveLedger(rows: LedgerRow[]): boolean {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}
