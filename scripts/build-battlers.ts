/**
 * Copies the vendored Aekashics battler source art (`assets/aekashics/`) into
 * `src/web/public/battlers/`, the served dir `src/web/battlers.ts` loads from
 * (ROG-68). No resize/recolor here - these are already final-size, complete
 * sprites; the mandatory palette-lock grade (`src/web/ART_DIRECTION.md` §2.4)
 * is a follow-up (ROG-70) that hooks in at this generation step.
 *
 * Run after adding/changing a vendored battler: pnpm tsx scripts/build-battlers.ts
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_DIR = fileURLToPath(
  new URL("../assets/aekashics/", import.meta.url),
);
const OUT_DIR = fileURLToPath(
  new URL("../src/web/public/battlers/", import.meta.url),
);

mkdirSync(OUT_DIR, { recursive: true });

const files = readdirSync(SOURCE_DIR).filter((name) => name.endsWith(".png"));
for (const name of files) {
  copyFileSync(`${SOURCE_DIR}${name}`, `${OUT_DIR}${name}`);
}

console.log(`${files.length} battler PNGs copied to ${OUT_DIR}`);
