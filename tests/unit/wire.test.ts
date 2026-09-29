import { describe, expect, it } from "vitest";
import { fromWire, toWire } from "../../src/core/jev/wire.ts";
import { RequestError, SchemaError } from "../../src/core/jev/errors.ts";
import type { DecideRequest } from "../../src/core/jev/types.ts";

const meta = { backend: "http" as const, requestHash: "h", wallMs: 1, cached: false, retries: 0 };

const choiceReq: DecideRequest = {
  model: "jev-1.13.0",
  state: "Help! My payouts have been failing for 3 days.",
  questions: {
    department: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payments, invoicing, refunds", technical: "Bugs, outages, integrations", sales: "Pricing, upgrades, new accounts" },
    },
  },
};

describe("toWire", () => {
  it("always sends model and passes state and questions through", () => {
    const w = toWire(choiceReq);
    expect(w.model).toBe("jev-1.13.0");
    expect(w.state).toBe(choiceReq.state);
    expect(Object.keys(w)).toEqual(["state", "model", "questions"]);
  });

  it("throws without a model", () => {
    expect(() => toWire({ ...choiceReq, model: "" })).toThrow(RequestError);
  });

  it("throws over 255 Choice options, and accepts exactly 255", () => {
    const mk = (n: number): DecideRequest => ({
      model: "m",
      state: "s",
      questions: { q: { type: "choice", instructions: "i", criteria: Object.fromEntries(Array.from({ length: n }, (_, i) => [`o${i}`, null])) } },
    });
    expect(() => toWire(mk(255))).not.toThrow();
    expect(() => toWire(mk(256))).toThrow(/255/);
  });

  it("enforces 2..10 Score levels", () => {
    const mk = (n: number): DecideRequest => ({
      model: "m",
      state: "s",
      questions: { q: { type: "score", instructions: "i", criteria: Array.from({ length: n }, (_, i) => `level ${i}`) } },
    });
    expect(() => toWire(mk(1))).toThrow(RequestError);
    expect(() => toWire(mk(2))).not.toThrow();
    expect(() => toWire(mk(10))).not.toThrow();
    expect(() => toWire(mk(11))).toThrow(RequestError);
  });

  it("sends Noul criteria with both true and false, or neither", () => {
    const base = { model: "m", state: "s" };
    expect(toWire({ ...base, questions: { q: { type: "noul", instructions: "i" } } }).questions.q).toEqual({ type: "noul", instructions: "i" });
    expect(
      toWire({ ...base, questions: { q: { type: "noul", instructions: "i", criteria: { true: "yes", false: "no" } } } }).questions.q,
    ).toEqual({ type: "noul", instructions: "i", criteria: { true: "yes", false: "no" } });
    expect(() =>
      toWire({ ...base, questions: { q: { type: "noul", instructions: "i", criteria: { true: "yes" } as never } } }),
    ).toThrow(RequestError);
  });
});

describe("fromWire: documented examples (api.md)", () => {
  it("parses the Noul example", () => {
    const req: DecideRequest = { model: "jev-latest", state: "x", questions: { is_urgent: { type: "noul", instructions: "Does this convey urgency?" } } };
    const r = fromWire(
      { model: "jev-1.13.0", answers: { is_urgent: { type: "noul", noul: 0.95 } }, usage: { input_tokens: 296, output_tokens: 20 } },
      req,
      meta,
    );
    expect(r.decisions.is_urgent).toEqual({ kind: "noul", p: 0.95 });
    expect(r.model).toBe("jev-1.13.0");
    expect(r.usage.inputTokens).toBe(296);
    expect(r.usage.outputTokens).toBe(20);
    expect(r.usage.costSource).toBe("list-price");
    expect(r.usage.costUsd).toBeCloseTo(296 * 0.042e-6, 15);
  });

  it("parses the Choice example", () => {
    const r = fromWire(
      {
        model: "jev-1.13.0",
        answers: { department: { type: "choice", choice: "billing", probabilities: { billing: 0.88, technical: 0.12, sales: 0.0 }, confidence: 0.81 } },
        usage: { input_tokens: 318, output_tokens: 34 },
      },
      choiceReq,
      meta,
    );
    expect(r.decisions.department).toEqual({
      kind: "choice",
      options: ["billing", "technical", "sales"],
      probs: [0.88, 0.12, 0.0],
      chosen: "billing",
      confidence: 0.81,
      confidenceSource: "reported",
    });
    expect(r.meta.warnings).toEqual([]);
  });

  it("parses the Score example with 0-indexed string keys", () => {
    const req: DecideRequest = {
      model: "jev-latest",
      state: "x",
      questions: { frustration: { type: "score", instructions: "How frustrated is the customer?", criteria: ["Calm", "Frustrated", "Very angry"] } },
    };
    const r = fromWire(
      {
        model: "jev-1.13.0",
        answers: {
          frustration: {
            type: "score",
            score: 1.05,
            legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
            probabilities: { "0": 0.0, "1": 0.95, "2": 0.05 },
            confidence: 0.92,
          },
        },
        usage: { input_tokens: 304, output_tokens: 18 },
      },
      req,
      meta,
    );
    expect(r.decisions.frustration).toEqual({
      kind: "score",
      levels: ["Calm", "Frustrated", "Very angry"],
      probs: [0.0, 0.95, 0.05],
      score: 1.05,
      confidence: 0.92,
      confidenceSource: "reported",
    });
  });
});

describe("fromWire: robustness", () => {
  const answer = (extra: Record<string, unknown> = {}) => ({
    type: "choice",
    choice: "billing",
    probabilities: { billing: 0.88, technical: 0.12, sales: 0.0 },
    ...extra,
  });

  it("accepts OpenRouter extras (id, provider, usage.cost) as optional", () => {
    const r = fromWire(
      { id: "gen-1", provider: "TypeSafe", model: "typesafe/jev-1.13", answers: { department: answer({ confidence: 0.81 }) }, usage: { input_tokens: 10, output_tokens: 0, cost: 0.0000123 } },
      choiceReq,
      meta,
    );
    expect(r.meta.id).toBe("gen-1");
    expect(r.meta.provider).toBe("TypeSafe");
    expect(r.usage.costUsd).toBe(0.0000123);
    expect(r.usage.costSource).toBe("reported");
  });

  it("derives confidence when it is missing", () => {
    const r = fromWire({ model: "m", answers: { department: answer() }, usage: { input_tokens: 1 } }, choiceReq, meta);
    const d = r.decisions.department!;
    expect(d.kind === "choice" && d.confidenceSource).toBe("derived");
    // (K·p_max − 1)/(K − 1) with K = 3, p_max = 0.88
    expect(d.kind === "choice" && d.confidence).toBeCloseTo((3 * 0.88 - 1) / 2, 12);
  });

  it("rejects an option-set mismatch", () => {
    expect(() =>
      fromWire(
        { model: "m", answers: { department: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 } } }, usage: { input_tokens: 1 } },
        choiceReq,
        meta,
      ),
    ).toThrow(SchemaError);
  });

  it("rejects an unknown answer type", () => {
    expect(() => fromWire({ model: "m", answers: { department: { type: "ranking" } }, usage: { input_tokens: 1 } }, choiceReq, meta)).toThrow(
      SchemaError,
    );
  });

  it("rejects a Choice answer with no probabilities", () => {
    expect(() =>
      fromWire({ model: "m", answers: { department: { type: "choice", choice: "billing", confidence: 0.8 } }, usage: { input_tokens: 1 } }, choiceReq, meta),
    ).toThrow(/no probabilities/);
  });

  it("warns (does not fail) when probabilities do not sum to 1 or choice is not the argmax", () => {
    const r = fromWire(
      { model: "m", answers: { department: { type: "choice", choice: "technical", probabilities: { billing: 0.6, technical: 0.3, sales: 0.0 } } }, usage: { input_tokens: 1 } },
      choiceReq,
      meta,
    );
    expect(r.meta.warnings.join(" ")).toMatch(/sum to 0\.9000/);
    expect(r.meta.warnings.join(" ")).toMatch(/not the argmax/);
  });

  it("rejects a response without usage", () => {
    expect(() => fromWire({ model: "m", answers: { department: answer() } }, choiceReq, meta)).toThrow(SchemaError);
  });
});
