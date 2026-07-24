/**
 * Whole-frame palette-lock grade (ROG-67 art direction §2.4/WEB-1): applied
 * once to `app.stage` in `bootGame.ts` so every scene (title, overworld,
 * village, dungeon, battle) - including the Aekashics battler sprites, which
 * are otherwise untouched by the Minifantasy-only atlas grade in
 * `scripts/build-atlas.ts` - gets the same subtle warm/saturated treatment.
 * This is what "heals the seam" between the two art sources per the art
 * direction's hybrid sourcing model.
 *
 * A plain factory function (not a class/singleton) so the matrix values are
 * easy to read and tune here without touching `bootGame.ts`.
 *
 * No unit test: constructing `ColorMatrixFilter` builds a `GlProgram`, which
 * probes a real `<canvas>`/WebGL context for max fragment precision at
 * construction time (`getTestContext`/`getMaxFragmentPrecision` in
 * pixi.js's `GlProgram`) - it throws `document is not defined` under plain
 * Vitest/node (verified directly; the repo has no jsdom/happy-dom
 * dependency, and this issue doesn't add one). Manually verified instead via
 * `node scripts/play-web.mjs` screenshots across scenes.
 *
 * Deliberately subtle: a touch of saturation and a slight warm hue push,
 * nothing that would blow out contrast or make the HP/MP state colors
 * (`heal`/`warn`/`danger`, art direction §7 - distinguishable by hue *and*
 * value) collapse toward each other.
 */

import { ColorMatrixFilter, type Filter } from "pixi.js";

/** Saturation boost: `0` = no change, `1` = fully saturated. Kept small. */
const GRADE_SATURATION = 0.12;
/** Hue rotation in degrees, a light push toward warm (positive = toward red/orange here). */
const GRADE_HUE_DEGREES = 4;
/** Brightness multiplier: `1` = no change. A hair over 1 keeps the grade from reading muddy. */
const GRADE_BRIGHTNESS = 1.03;

/**
 * Builds the palette-lock grade filter for `app.stage.filters`. Returns a
 * single-element array (rather than a bare `Filter`) since Pixi v8's
 * `filters` property always takes an array.
 */
export function createPaletteGrade(): Filter[] {
  const grade = new ColorMatrixFilter();
  grade.hue(GRADE_HUE_DEGREES, true);
  grade.saturate(GRADE_SATURATION, true);
  grade.brightness(GRADE_BRIGHTNESS, true);
  return [grade];
}
