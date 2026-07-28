import { describe, expect, it } from "vitest";

import { checkpointedSessionId, formatCheckpointComment } from "./checkpoint";

describe("context-checkpoint markers", () => {
  it("finds no checkpoint in an unmarked thread", () => {
    expect(checkpointedSessionId([])).toBeNull();
    expect(checkpointedSessionId(["a normal comment", "another"])).toBeNull();
  });

  it("names the eve session the newest checkpoint retires", () => {
    expect(
      checkpointedSessionId([
        formatCheckpointComment("sess-old", "phase 1 done"),
        "a human reply",
        formatCheckpointComment("sess-new", "phase 2 done"),
      ]),
    ).toBe("sess-new");
  });

  it("keeps the brief readable and the marker out of it", () => {
    const body = formatCheckpointComment("sess-1", "PR #12 open; next: review");
    expect(body).toContain("PR #12 open; next: review");
    // The brief is what a human reads in the Linear thread, so the marker has to
    // stay an HTML comment on its own line rather than visible prose.
    expect(body.split("\n")[0]).toBe("<!-- eve-checkpoint session=sess-1 -->");
    expect(checkpointedSessionId([body])).toBe("sess-1");
  });

  it("ignores a marker-shaped comment with no session id", () => {
    expect(checkpointedSessionId(["<!-- eve-checkpoint -->"])).toBeNull();
    expect(
      checkpointedSessionId(["<!-- eve-checkpoint session= -->"]),
    ).toBeNull();
  });
});
