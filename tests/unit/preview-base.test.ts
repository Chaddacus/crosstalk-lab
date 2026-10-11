import { describe, expect, it } from "vitest";
import { resolveBase } from "../../vite.base";

describe("resolveBase", () => {
  it("serves from the root when no preview path is set", () => {
    expect(resolveBase({})).toBe("/");
    expect(resolveBase({ CROSSTALK_BASE: "" })).toBe("/");
  });

  it("puts a PR preview under its path with leading and trailing slashes", () => {
    expect(resolveBase({ CROSSTALK_BASE: "/crosstalk-lab/pr-preview/pr-7/" })).toBe("/crosstalk-lab/pr-preview/pr-7/");
    expect(resolveBase({ CROSSTALK_BASE: "crosstalk-lab/pr-preview/pr-7" })).toBe("/crosstalk-lab/pr-preview/pr-7/");
  });

  it("refuses absolute URLs and path escapes", () => {
    expect(() => resolveBase({ CROSSTALK_BASE: "https://example.com/x/" })).toThrow();
    expect(() => resolveBase({ CROSSTALK_BASE: "/a/../b/" })).toThrow();
  });
});
