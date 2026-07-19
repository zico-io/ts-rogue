import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { brokenLinks, productDocsRequired } from "./check-docs.mjs";

test("finds broken local Markdown links", () => {
  const root = mkdtempSync(join(tmpdir(), "ts-rogue-docs-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "README.md"), "[good](docs/product.md) [bad](missing.md)\n");
  writeFileSync(join(root, "docs/product.md"), "# Product\n");
  assert.deepEqual(brokenLinks(root), ["README.md -> missing.md"]);
});

test("requires product docs for product changes", () => {
  assert.equal(productDocsRequired(["src/app.tsx"]), true);
  assert.equal(productDocsRequired(["src/app.tsx", "docs/product.md"]), false);
  assert.equal(productDocsRequired(["AGENTS.md"]), false);
});
