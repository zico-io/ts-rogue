import { describe, expect, it } from "vitest";

import {
  epochContinuationToken,
  epochFromComments,
  formatCheckpointComment,
  latestCheckpointBrief,
} from "./checkpoint";

describe("checkpoint epoch derivation", () => {
  it("is epoch 0 with no checkpoint comments", () => {
    expect(epochFromComments([])).toBe(0);
    expect(epochFromComments(["just a normal comment", "another"])).toBe(0);
    expect(latestCheckpointBrief(["normal", "comment"])).toBeNull();
  });

  it("counts checkpoint-marker comments as the epoch", () => {
    const comments = [
      "normal comment",
      formatCheckpointComment("phase 1 done, PR #12 open; next: address review"),
      "a human reply",
      formatCheckpointComment("review addressed; next: merge"),
    ];
    expect(epochFromComments(comments)).toBe(2);
  });

  it("returns the latest checkpoint brief, marker and heading stripped", () => {
    const comments = [
      formatCheckpointComment("older brief"),
      "chatter",
      formatCheckpointComment("newest brief: do X next"),
    ];
    const brief = latestCheckpointBrief(comments);
    expect(brief).toBe("newest brief: do X next");
    expect(brief).not.toContain("<!-- eve-checkpoint -->");
    expect(brief).not.toContain("Context checkpoint");
  });

  it("derives a fresh, never-seen token per epoch; epoch 0 is the base token", () => {
    const id = "abc-123";
    const base = epochContinuationToken(id, 0);
    expect(base).toBe(`agent-session:${id}`);
    // Epochs > 0 suffix the base with a distinct, deterministic tail.
    expect(epochContinuationToken(id, 1)).toBe(`agent-session:${id}:e1`);
    expect(epochContinuationToken(id, 2)).toBe(`agent-session:${id}:e2`);
    // Negative/zero collapse to the base (defensive).
    expect(epochContinuationToken(id, -1)).toBe(base);
  });
});
