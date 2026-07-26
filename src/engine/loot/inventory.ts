import type { ItemInstance } from "./types";

export const FIELD_BACKPACK_CAP = 20;

export function isFieldBackpackFull(items: readonly ItemInstance[]): boolean {
  return items.length >= FIELD_BACKPACK_CAP;
}
