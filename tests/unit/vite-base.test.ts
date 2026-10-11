import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBase(): Promise<string> {
  vi.resetModules();
  const mod = await import("../../vite.config");
  return mod.base;
}

describe("vite base path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the site root", async () => {
    vi.stubEnv("VITE_BASE", "");
    expect(await loadBase()).toBe("/");
  });

  it("uses VITE_BASE so a PR preview loads assets under its own path", async () => {
    vi.stubEnv("VITE_BASE", "/crosstalk-lab/pr-preview/pr-4/");
    expect(await loadBase()).toBe("/crosstalk-lab/pr-preview/pr-4/");
  });
});
