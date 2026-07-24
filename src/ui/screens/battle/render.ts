/**
 * Pure rendering helpers for the battle screen. No Ink/React import so this
 * stays trivially unit-testable; `BattleScreen.tsx` is the thin Ink wrapper.
 *
 * `packEnemyColumns` lays out the enemy art so it reflows to the available
 * width: enemy columns are greedily packed into rows that fit within the
 * terminal width, wrapping to a new row when the next column would overflow.
 * This keeps multiple enemies side by side on wide terminals and stacks them
 * on narrow ones without clipping or overlap.
 */

import type { BattleEnemy } from "../../../engine/combat/types";

export interface EnemyColumn {
  enemy: BattleEnemy;
  selected: boolean;
  dead: boolean;
  nameLine: string;
  hpLine: string;
  width: number;
  height: number;
}

export interface PackedEnemies {
  /** Enemy columns grouped into visual rows (left to right, top to bottom). */
  rows: EnemyColumn[][];
  /** Total terminal rows the field occupies, including gaps between rows. */
  fieldHeight: number;
  /** Width of the widest visual row. */
  fieldWidth: number;
}

export interface PackOptions {
  columns: number;
  /** Horizontal gap between enemy columns in the same row. */
  gap?: number;
  /** Vertical gap between wrapped rows. */
  rowGap?: number;
  /** Fixed art size in cells (browser sprites) instead of ASCII art. */
  artSize?: { width: number; height: number };
}

/** Name line for an enemy column, with a selection marker and defeat suffix. */
export function enemyNameLine(
  enemy: BattleEnemy,
  selected: boolean,
  dead: boolean,
): string {
  return `${selected ? "> " : "  "}${enemy.name}${dead ? " (defeated)" : ""}`;
}

/** HP line for an enemy column, e.g. `HP 12/12`. */
export function enemyHpLine(enemy: BattleEnemy): string {
  return `HP ${enemy.hp}/${enemy.maxHp}`;
}

/** Widest line in an enemy column (art, name, or HP). */
export function enemyColumnWidth(
  enemy: BattleEnemy,
  selected: boolean,
  dead: boolean,
  artWidth?: number,
): number {
  const asciiWidth =
    artWidth ??
    enemy.ascii.reduce((max, line) => Math.max(max, line.length), 0);
  return Math.max(
    asciiWidth,
    enemyNameLine(enemy, selected, dead).length,
    enemyHpLine(enemy).length,
  );
}

/** Rows an enemy column occupies: art lines plus the name and HP lines. */
export function enemyColumnHeight(
  enemy: BattleEnemy,
  artHeight?: number,
): number {
  return (artHeight ?? enemy.ascii.length) + 2;
}

function rowWidth(row: EnemyColumn[], gap: number): number {
  return row.reduce((sum, col) => sum + col.width, 0) + (row.length - 1) * gap;
}

function rowHeight(row: EnemyColumn[]): number {
  return row.reduce((max, col) => Math.max(max, col.height), 0);
}

/**
 * Greedily pack enemy columns into rows that fit within `columns`. The
 * `aliveEnemies`/`selectingTarget`/`targetCursor` args mirror the screen so
 * the selection marker lands on the right column.
 */
export function packEnemyColumns(
  enemies: readonly BattleEnemy[],
  aliveEnemies: readonly BattleEnemy[],
  selectingTarget: boolean,
  targetCursor: number,
  options: PackOptions,
): PackedEnemies {
  const { columns, gap = 4, rowGap = 1, artSize } = options;

  const cols: EnemyColumn[] = enemies.map((enemy) => {
    const aliveIndex = aliveEnemies.findIndex((entry) => entry.id === enemy.id);
    const selected = selectingTarget && aliveIndex === targetCursor;
    const dead = enemy.hp <= 0;
    return {
      enemy,
      selected,
      dead,
      nameLine: enemyNameLine(enemy, selected, dead),
      hpLine: enemyHpLine(enemy),
      width: enemyColumnWidth(enemy, selected, dead, artSize?.width),
      height: enemyColumnHeight(enemy, artSize?.height),
    };
  });

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

  const fieldWidth = rows.reduce(
    (max, row) => Math.max(max, rowWidth(row, gap)),
    0,
  );
  const fieldHeight = rows.reduce(
    (sum, row, index) => sum + rowHeight(row) + (index > 0 ? rowGap : 0),
    0,
  );

  return { rows, fieldHeight, fieldWidth };
}
