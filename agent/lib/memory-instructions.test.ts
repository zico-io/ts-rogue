import { describe, expect, it } from "vitest";

import type { Memory } from "./memory-store";
import {
  buildMemoryInstructionsMarkdown,
  resolveMemoryInstructions,
} from "./memory-instructions";

const SAMPLE_MEMORY: Memory = {
  key: "workaround.eve-sandbox-flake",
  value: "Retried sandbox creation twice before it stabilized.",
  category: "workaround",
  source: "HAR-73 session",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

describe("buildMemoryInstructionsMarkdown", () => {
  it("returns null when there are no memories", () => {
    expect(buildMemoryInstructionsMarkdown([])).toBeNull();
  });

  it("JSON-encodes memories and frames them as untrusted", () => {
    const markdown = buildMemoryInstructionsMarkdown([SAMPLE_MEMORY]);
    expect(markdown).toContain("untrusted stored data");
    expect(markdown).toContain(JSON.stringify([SAMPLE_MEMORY]));
  });
});

describe("resolveMemoryInstructions", () => {
  it("returns null when the store has nothing saved", async () => {
    await expect(resolveMemoryInstructions(async () => [])).resolves.toBeNull();
  });

  it("returns instructions markdown built from the listed memories", async () => {
    const result = await resolveMemoryInstructions(async () => [SAMPLE_MEMORY]);
    expect(result?.markdown).toContain(JSON.stringify([SAMPLE_MEMORY]));
  });

  it("degrades to null instead of throwing when the store is unavailable", async () => {
    await expect(
      resolveMemoryInstructions(async () => {
        throw new Error("turso unreachable");
      }),
    ).resolves.toBeNull();
  });
});
