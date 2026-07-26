/**
 * Field-backpack capacity (ENG-5, workstream 3 of the ENG-2 inventory epic).
 * The cap only governs generated, affix-bearing gear (`GameState.items`);
 * consumable stacks (`inventory`), currency (`gold`), and quest items never
 * count against it and never will - the unlimited village `stash` is the
 * pressure release valve for gear specifically. Named and exported so no
 * other module inlines the number.
 */

import type { ItemInstance } from "./types";

/** Tunable cap on field-carried generated gear. */
export const FIELD_BACKPACK_CAP = 20;

/** Whether `items` is already at (or somehow past) the field backpack cap. */
export function isFieldBackpackFull(items: readonly ItemInstance[]): boolean {
  return items.length >= FIELD_BACKPACK_CAP;
}
