import { ColorMatrixFilter, type Filter } from "pixi.js";

const GRADE_SATURATION = 0.12;

const GRADE_HUE_DEGREES = 4;

const GRADE_BRIGHTNESS = 1.03;

export function createPaletteGrade(): Filter[] {
  const grade = new ColorMatrixFilter();
  grade.hue(GRADE_HUE_DEGREES, true);
  grade.saturate(GRADE_SATURATION, true);
  grade.brightness(GRADE_BRIGHTNESS, true);
  return [grade];
}
