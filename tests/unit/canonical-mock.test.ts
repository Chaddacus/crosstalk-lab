import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashJson, sha256Hex } from "../../src/core/jev/canonical.ts";
import { requestCanonical, requestHash } from "../../src/core/jev/request-hash.ts";
import { toWire } from "../../src/core/jev/wire.ts";
import { createMockBackend, NONE_OPTION } from "../../src/core/jev/mock-lexsim.ts";
import { UnsupportedInMock } from "../../src/core/jev/errors.ts";
import { buildRequest } from "../../src/core/run/request.ts";
import type { Criterion } from "../../src/core/jev/types.ts";

const v0: Record<string, Criterion> = JSON.parse(readFileSync("data/twilio-v2010/criteria.v0.json", "utf8"));

describe("canonical JSON and hashing", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: "x" }], e: "é" })).toBe('{"a":[1,{"c":"x","d":2}],"b":1,"e":"é"}');
  });

  it("key order does not change the hash", async () => {
    expect(await hashJson({ a: 1, b: { c: 2, d: 3 } })).toBe(await hashJson({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("matches pinned known answers (computed independently with Python hashlib)", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashJson({ b: 1, a: [1, { d: 2, c: "x" }], e: "é" })).toBe("2c2fdd3758b35f842df34f5e7154625d7af688aef5b51f8cb3e161555a7d45f5");
  });

  it("the cached request hash equals the hash of the canonical wire body", async () => {
    const req = buildRequest(v0, "Hang up call CAxxxx0042 now.", "jev-1.13.0");
    const w = toWire(req);
    expect(requestCanonical(req)).toBe(canonicalJson({ model: w.model, state: w.state, questions: w.questions }));
    expect(await requestHash(req)).toBe(await hashJson({ model: w.model, state: w.state, questions: w.questions }));
  });
});

describe("lexical mock", () => {
  const mock = createMockBackend();
  const decide = async (criteria: Record<string, Criterion>, q: string) => {
    const r = await mock.decide(buildRequest(criteria, q, "mock-lexsim-1"));
    const d = r.decisions.operation!;
    if (d.kind !== "choice") throw new Error("not a choice");
    return { d, r, p: (o: string) => d.probs[d.options.indexOf(o)]! };
  };

  it("gives bit-identical output for the same input", async () => {
    const a = await decide(v0, "Stop the recording in conference CFxxxx5006.");
    const b = await createMockBackend().decide(buildRequest(v0, "Stop the recording in conference CFxxxx5006.", "mock-lexsim-1"));
    const db = b.decisions.operation!;
    expect(db.kind === "choice" && db.probs).toEqual(a.d.probs);
    expect(b.meta.requestHash).toBe(a.r.meta.requestHash);
  });

  it("returns probabilities that sum to 1 within 1e-9, over all 198 options", async () => {
    const { d } = await decide(v0, "List every phone number we own.");
    expect(d.options).toHaveLength(198);
    expect(Math.abs(d.probs.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
  });

  it("adding a query term to an option's `what` raises that option's probability", async () => {
    const q = "Hang up call CAxxxx0042 now.";
    const before = (await decide(v0, q)).p("UpdateCall");
    const edited = { ...v0, UpdateCall: { ...(v0.UpdateCall as object), what: "Initiates a call redirect or terminates a call. Hang up a live call." } };
    const after = (await decide(edited, q)).p("UpdateCall");
    expect(after).toBeGreaterThan(before);
  });

  it("matching `not_for` lowers the option's probability", async () => {
    const q = "Stop the recording in conference CFxxxx5006.";
    const before = (await decide(v0, q)).p("DeleteConferenceRecording");
    const edited = { ...v0, DeleteConferenceRecording: { ...(v0.DeleteConferenceRecording as object), not_for: "stop or pause a recording" } };
    const after = (await decide(edited, q)).p("DeleteConferenceRecording");
    expect(after).toBeLessThan(before);
  });

  it("routes an off-topic query to none_of_these", async () => {
    const { d } = await decide(v0, "what's the weather in Denver");
    expect(d.chosen).toBe(NONE_OPTION);
  });

  it("uses the derived confidence formula and estimated usage", async () => {
    const { d, r } = await decide(v0, "Create a queue for weekend callers.");
    const k = d.probs.length;
    const pmax = Math.max(...d.probs);
    expect(d.confidence).toBeCloseTo(Math.max(0, (k * pmax - 1) / (k - 1)), 12);
    expect(d.confidenceSource).toBe("derived");
    expect(r.usage.costSource).toBe("estimated");
    expect(r.usage.inputTokens).toBe(Math.ceil(requestCanonical(buildRequest(v0, "Create a queue for weekend callers.", "mock-lexsim-1")).length / 4));
  });

  it("supports Choice only", async () => {
    await expect(
      mock.decide({ model: "m", state: "s", questions: { q: { type: "noul", instructions: "yes?" } } }),
    ).rejects.toBeInstanceOf(UnsupportedInMock);
  });
});
