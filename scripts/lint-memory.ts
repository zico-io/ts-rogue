import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const MEMORY_DIR = ".botfile/memory";

export type Severity = "error" | "warn";

export interface Violation {
  file: string;
  line: number;
  severity: Severity;
  message: string;
}

export interface Bullet {
  file: string;
  line: number;

  refs: string[];

  date?: string;
}

const SOURCE_TAG = /<source:([^>]*)>/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function refPath(ref: string): string {
  return ref.trim().split(/\s+/)[0] ?? "";
}

export function parseSourceTag(
  text: string,
): { refs: string[]; date?: string } | null {
  const match = SOURCE_TAG.exec(text);
  if (!match) return null;
  const inner = match[1].trim();
  const comma = inner.lastIndexOf(",");
  if (comma === -1) return { refs: splitRefs(inner) };
  const date = inner.slice(comma + 1).trim();
  const refs = splitRefs(inner.slice(0, comma));
  return { refs, date: isIsoDate(date) ? date : undefined };
}

function splitRefs(raw: string): string[] {
  return raw
    .split(/\s+and\s+/)
    .map((r) => r.trim())
    .filter(Boolean);
}

export function parseMemoryFile(text: string, file: string): Bullet[] {
  const bullets: Bullet[] = [];
  text.split("\n").forEach((raw, i) => {
    if (!/^\s*-\s+/.test(raw)) return;
    const tag = parseSourceTag(raw);
    bullets.push({ file, line: i + 1, refs: tag?.refs ?? [], date: tag?.date });
  });
  return bullets;
}

export function lintFormat(text: string, file: string): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((raw, i) => {
    if (!/^\s*-\s+/.test(raw)) return;
    const tag = parseSourceTag(raw);
    if (!tag) {
      out.push({
        file,
        line: i + 1,
        severity: "error",
        message: "fact is missing a <source: …, YYYY-MM-DD> tag",
      });
      return;
    }
    if (!tag.date)
      out.push({
        file,
        line: i + 1,
        severity: "error",
        message: "<source> tag has no valid YYYY-MM-DD date",
      });
  });
  return out;
}

export function lintEmDash(text: string, file: string): Violation[] {
  const out: Violation[] = [];
  text.split("\n").forEach((raw, i) => {
    if (raw.includes("—"))
      out.push({
        file,
        line: i + 1,
        severity: "error",
        message: "em dash (—) is banned; use a plain '-'",
      });
  });
  return out;
}

export function checkIndex(
  indexText: string,
  memoryFiles: string[],
): Violation[] {
  const listed = new Set(
    [...indexText.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]),
  );
  const out: Violation[] = [];
  for (const f of memoryFiles)
    if (!listed.has(f))
      out.push({
        file: "index.md",
        line: 1,
        severity: "warn",
        message: `memory file '${f}' is not listed in index.md`,
      });
  for (const f of listed)
    if (!memoryFiles.includes(f))
      out.push({
        file: "index.md",
        line: 1,
        severity: "warn",
        message: `index.md lists '${f}', which does not exist`,
      });
  return out;
}

export function checkFreshness(
  bullets: Bullet[],
  gitDates: Record<string, string>,
): Violation[] {
  const out: Violation[] = [];
  for (const b of bullets) {
    if (!b.date) continue;
    for (const ref of b.refs) {
      const path = refPath(ref);
      const committed = gitDates[path];
      if (committed && committed > b.date)
        out.push({
          file: b.file,
          line: b.line,
          severity: "warn",
          message: `source '${path}' changed on ${committed}, after the fact's ${b.date} - re-verify`,
        });
    }
  }
  return out;
}

function listMemoryFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMemoryFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function lastCommitDate(path: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", path], {
      encoding: "utf8",
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function main(): void {
  const files = listMemoryFiles(MEMORY_DIR);
  const violations: Violation[] = [];
  const allBullets: Bullet[] = [];

  for (const path of files) {
    const rel = relative(MEMORY_DIR, path);
    const text = readFileSync(path, "utf8");
    violations.push(...lintFormat(text, rel), ...lintEmDash(text, rel));
    if (rel !== "index.md") allBullets.push(...parseMemoryFile(text, rel));
  }

  const indexPath = join(MEMORY_DIR, "index.md");
  const memoryRel = files
    .map((f) => relative(MEMORY_DIR, f))
    .filter((f) => f !== "index.md");
  violations.push(...checkIndex(readFileSync(indexPath, "utf8"), memoryRel));

  const gitDates: Record<string, string> = {};
  for (const ref of new Set(allBullets.flatMap((b) => b.refs.map(refPath)))) {
    const date = lastCommitDate(ref);
    if (date) gitDates[ref] = date;
  }
  violations.push(...checkFreshness(allBullets, gitDates));

  if (violations.length === 0) {
    console.log("docs:lint - memory is clean");
    return;
  }
  console.log(`docs:lint - ${violations.length} item(s) to review:\n`);
  for (const v of violations)
    console.log(
      `  ${v.severity === "error" ? "x" : "!"} ${v.file}:${v.line}  ${v.message}`,
    );
  console.log("\n(warn-only: this never blocks a build)");
}

if (process.argv[1]?.endsWith("lint-memory.ts")) main();
