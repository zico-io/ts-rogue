/**
 * Field backpack sizing (ENG-2). The party carries only so much rolled gear
 * on an expedition; unlimited storage lives back at the village stash
 * (`GameState.stash`, see `state/store.ts`'s `depositItem`/`withdrawItem`).
 * Consumables (`GameState.inventory`), gold, and quest items (none exist yet)
 * never count against this cap - only `GameState.items` length does.
 */

import type { PartyMember } from "../entities/party";

/** Maximum number of rolled gear instances the field backpack (`state.items`) can hold. */
export const FIELD_BACKPACK_CAP = 20;

/** Highest level among living-or-not party members; loot filter ilvl gating uses this. */
export function maxPartyLevel(party: readonly PartyMember[]): number {
  return party.reduce((max, member) => Math.max(max, member.level), 0);
}
