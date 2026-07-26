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
