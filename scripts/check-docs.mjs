import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ignoredDirectories = new Set([".git", "node_modules"]);
const productPaths = /^(src\/|package\.json$|pnpm-lock\.yaml$|\.node-version$)/;

export function markdownFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) visit(resolve(directory, entry.name));
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(resolve(directory, entry.name));
    }
  };
  visit(root);
  return files;
}

export function brokenLinks(root) {
  const failures = [];
  for (const file of markdownFiles(root)) {
    const markdown = readFileSync(file, "utf8");
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      const path = resolve(dirname(file), decodeURIComponent(target));
      if (!existsSync(path)) failures.push(`${relative(root, file)} -> ${target}`);
    }
  }
  return failures;
}

export function productDocsRequired(changedFiles) {
  return changedFiles.some((file) => productPaths.test(file)) && !changedFiles.includes("docs/product.md");
}

function changedFiles(root, baseSha) {
  if (!baseSha) return [];
  return execFileSync("git", ["diff", "--name-only", `${baseSha}...HEAD`], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const failures = brokenLinks(root);
  if (productDocsRequired(changedFiles(root, process.env.BASE_SHA))) {
    failures.push("product code or runtime configuration changed without docs/product.md");
  }
  if (failures.length) {
    console.error(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Documentation is current.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
