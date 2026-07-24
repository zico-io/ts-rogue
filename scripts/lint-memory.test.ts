import { describe, expect, it } from "vitest";
import {
  checkFreshness,
  checkIndex,
  isIsoDate,
  lintEmDash,
  lintFormat,
  parseMemoryFile,
  parseSourceTag,
  refPath,
} from "./lint-memory";

describe("parseSourceTag", () => {
  it("splits refs on ' and ' and reads the trailing date", () => {
    expect(parseSourceTag("- x <source: a and b, 2026-07-20>")).toEqual({
      refs: ["a", "b"],
      date: "2026-07-20",
    });
  });

  it("returns null when there is no source tag", () => {
    expect(parseSourceTag("- a bare fact")).toBeNull();
  });

  it("drops a malformed date", () => {
    expect(parseSourceTag("- x <source: a, 2026-7-2>")?.date).toBeUndefined();
  });
});

describe("isIsoDate", () => {
  it("rejects impossible calendar dates", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-07-23")).toBe(true);
  });
});

describe("refPath", () => {
  it("takes the leading path token", () => {
    expect(refPath("PROJECT_PLAN.md section 2")).toBe("PROJECT_PLAN.md");
  });
});

describe("lintFormat", () => {
  it("flags a fact with no source tag", () => {
    const v = lintFormat("- a fact with no source", "f.md");
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/missing a <source/);
  });

  it("passes a well-formed fact and ignores non-bullet lines", () => {
    const text = "# Title\n\n- good <source: pkg.json, 2026-07-20>";
    expect(lintFormat(text, "f.md")).toEqual([]);
  });

  it("flags a source tag with no valid date", () => {
    const v = lintFormat("- x <source: a>", "f.md");
    expect(v[0].message).toMatch(/no valid YYYY-MM-DD/);
  });
});

describe("lintEmDash", () => {
  it("catches an em dash", () => {
    const v = lintEmDash("- one — two", "f.md");
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(1);
  });
});

describe("checkIndex", () => {
  it("reports a memory file missing from the index", () => {
    const v = checkIndex("- `domain/product.md`", ["domain/product.md", "tools/x.md"]);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/tools\/x\.md.*not listed/);
  });

  it("reports an index entry with no backing file", () => {
    const v = checkIndex("- `tools/gone.md`", []);
    expect(v[0].message).toMatch(/does not exist/);
  });
});

describe("checkFreshness", () => {
  it("warns when a source file changed after the fact's date", () => {
    const bullets = parseMemoryFile(
      "- x <source: PROJECT_PLAN.md section 2, 2026-07-19>",
      "domain/product.md",
    );
    const v = checkFreshness(bullets, { "PROJECT_PLAN.md": "2026-07-21" });
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/changed on 2026-07-21/);
  });

  it("stays quiet when the source has not changed since the fact", () => {
    const bullets = parseMemoryFile("- x <source: a, 2026-07-21>", "f.md");
    expect(checkFreshness(bullets, { a: "2026-07-21" })).toEqual([]);
    expect(checkFreshness(bullets, { a: "2026-07-19" })).toEqual([]);
  });
});
