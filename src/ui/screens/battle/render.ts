import { enemyRow, isMeleeTargetable } from "../../../engine/combat/resolution";
import type { EffectInstance } from "../../../engine/combat/statusEffects";
import { findStatusEffect } from "../../../engine/combat/statusEffects";
import type { BattleEnemy, EnemyRow } from "../../../engine/combat/types";

export interface EnemyColumn {
  enemy: BattleEnemy;
  selected: boolean;
  dead: boolean;

  // Back row while the front row still lives, per the melee reachability
  // rule (ENG-29/ROG-78) - true only for a living back-row enemy a basic
  // attack can't currently reach.
  meleeUnreachable: boolean;
  formationRow: EnemyRow;

  nameLine: string;
  hpLine: string;
  badges: EffectBadge[];
  width: number;
  height: number;
}

export interface PackedEnemies {
  rows: EnemyColumn[][];

  // Index into `rows` where the back-row formation block begins, so the
  // caller can render a divider between front and back row. Null when
  // every enemy is in the front row (no back-row block to separate).
  formationBreakIndex: number | null;

  fieldHeight: number;

  fieldWidth: number;
}

export interface PackOptions {
  columns: number;

  gap?: number;

  rowGap?: number;

  artSize?: { width: number; height: number };
}

export function enemyNameLine(
  enemy: BattleEnemy,
  selected: boolean,
  dead: boolean,
  meleeUnreachable = false,
): string {
  const suffix = dead
    ? " (defeated)"
    : meleeUnreachable
      ? " (unreachable)"
      : "";
  return `${selected ? "> " : "  "}${enemy.name}${suffix}`;
}

export function enemyHpLine(enemy: BattleEnemy): string {
  return `HP ${enemy.hp}/${enemy.maxHp}`;
}

export interface EffectBadge {
  id: EffectInstance["effectId"];
  label: string;
}

// Turns an actor's active status effects into badge labels with turns
// remaining (e.g. "Poison x2"), for BattleScreen to render next to the
// afflicted party member or enemy.
export function effectBadges(
  effects: readonly EffectInstance[] | undefined,
): EffectBadge[] {
  if (!effects || effects.length === 0) return [];
  return effects.map((effect) => {
    const def = findStatusEffect(effect.effectId);
    return {
      id: effect.effectId,
      label: `${def?.name ?? effect.effectId} x${effect.duration}`,
    };
  });
}

export function enemyColumnWidth(
  enemy: BattleEnemy,
  selected: boolean,
  dead: boolean,
  artWidth?: number,
  meleeUnreachable = false,
): number {
  const asciiWidth =
    artWidth ??
    enemy.ascii.reduce((max, line) => Math.max(max, line.length), 0);
  const badgeWidth = effectBadges(enemy.effects)
    .map((badge) => badge.label)
    .join("  ").length;
  return Math.max(
    asciiWidth,
    enemyNameLine(enemy, selected, dead, meleeUnreachable).length,
    enemyHpLine(enemy).length,
    badgeWidth,
  );
}

export function enemyColumnHeight(
  enemy: BattleEnemy,
  artHeight?: number,
): number {
  const badgeLines = effectBadges(enemy.effects).length > 0 ? 1 : 0;
  return (artHeight ?? enemy.ascii.length) + 2 + badgeLines;
}

function rowWidth(row: EnemyColumn[], gap: number): number {
  return row.reduce((sum, col) => sum + col.width, 0) + (row.length - 1) * gap;
}

function rowHeight(row: EnemyColumn[]): number {
  return row.reduce((max, col) => Math.max(max, col.height), 0);
}

function wrapIntoRows(
  cols: readonly EnemyColumn[],
  columns: number,
  gap: number,
): EnemyColumn[][] {
  const rows: EnemyColumn[][] = [];
  let current: EnemyColumn[] = [];
  let currentWidth = 0;
  for (const col of cols) {
    if (current.length > 0 && currentWidth + gap + col.width > columns) {
      rows.push(current);
      current = [col];
      currentWidth = col.width;
    } else {
      currentWidth += current.length === 0 ? col.width : gap + col.width;
      current.push(col);
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

// Packs the encounter's formation into visual rows for BattleScreen: the
// front-row block wraps to the viewport width first, then the back-row
// block wraps separately below it (TER-3) - the two never share a wrapped
// line, so the front/back split always reads as a visual break, not just a
// width-driven line wrap. `highlightedIds` drives which columns render as
// selected; it's an id set rather than a single cursor index so a
// row/column skill's whole target list can highlight at once.
export function packEnemyColumns(
  enemies: readonly BattleEnemy[],
  highlightedIds: ReadonlySet<string>,
  options: PackOptions,
): PackedEnemies {
  const { columns, gap = 4, rowGap = 1, artSize } = options;

  function buildColumn(enemy: BattleEnemy): EnemyColumn {
    const selected = highlightedIds.has(enemy.id);
    const dead = enemy.hp <= 0;
    const meleeUnreachable = !dead && !isMeleeTargetable(enemies, enemy);
    return {
      enemy,
      selected,
      dead,
      meleeUnreachable,
      formationRow: enemyRow(enemy),
      nameLine: enemyNameLine(enemy, selected, dead, meleeUnreachable),
      hpLine: enemyHpLine(enemy),
      badges: effectBadges(enemy.effects),
      width: enemyColumnWidth(
        enemy,
        selected,
        dead,
        artSize?.width,
        meleeUnreachable,
      ),
      height: enemyColumnHeight(enemy, artSize?.height),
    };
  }

  const frontCols = enemies
    .filter((enemy) => enemyRow(enemy) === "front")
    .map(buildColumn);
  const backCols = enemies
    .filter((enemy) => enemyRow(enemy) === "back")
    .map(buildColumn);

  const frontRows = wrapIntoRows(frontCols, columns, gap);
  const backRows = wrapIntoRows(backCols, columns, gap);

  const rows = [...frontRows, ...backRows];
  const formationBreakIndex = backRows.length > 0 ? frontRows.length : null;

  const fieldWidth = rows.reduce(
    (max, row) => Math.max(max, rowWidth(row, gap)),
    0,
  );
  const fieldHeight =
    rows.reduce(
      (sum, row, index) => sum + rowHeight(row) + (index > 0 ? rowGap : 0),
      0,
    ) + (formationBreakIndex !== null ? 1 : 0);

  return { rows, formationBreakIndex, fieldHeight, fieldWidth };
}
