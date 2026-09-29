/**
 * Runs MOCK and REPLAY jobs off the main thread with the same isomorphic core the CLI uses.
 * Posts each result as it completes, then the finished run record with its measured wall time.
 */
import { createMockBackend } from "../../core/jev/mock-lexsim.ts";
import { createReplayBackend, fixtureStore, type ReplayFixture } from "../../core/jev/replay.ts";
import { runItems } from "../../core/run/runner.ts";
import type { Item } from "../../core/data/splits.ts";
import type { Criterion } from "../../core/jev/types.ts";

export type WorkerRequest =
  | {
      type: "run";
      runId: number;
      backend: "mock" | "replay";
      items: Item[];
      criteria: Record<string, Criterion>;
      criteriaHash: string;
      criteriaVersion: string;
      model: string;
      split: "dev" | "test";
      order: string[];
    }
  | { type: "replay-fixtures"; fixtures: ReplayFixture[] };

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
};
const mock = createMockBackend();
let fixtures: ReplayFixture[] = [];
let store = fixtureStore(fixtures);
const replay = createReplayBackend({ get: (h) => store.get(h) });

scope.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "replay-fixtures") {
    fixtures = [...fixtures, ...msg.fixtures];
    store = fixtureStore(fixtures);
    return;
  }
  try {
    const record = await runItems({
      backend: msg.backend === "mock" ? mock : replay,
      items: msg.items,
      criteria: msg.criteria,
      criteriaHash: msg.criteriaHash,
      criteriaVersion: msg.criteriaVersion,
      model: msg.model,
      split: msg.split,
      order: msg.order,
      concurrency: 16,
      onResult: (result, done, total) => scope.postMessage({ type: "result", runId: msg.runId, result, done, total }),
    });
    scope.postMessage({ type: "done", runId: msg.runId, record });
  } catch (e) {
    scope.postMessage({ type: "failed", runId: msg.runId, message: (e as Error).message });
  }
};
