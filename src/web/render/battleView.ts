/**
 * Pixi counterpart of `src/ui/screens/BattleScreen.tsx` +
 * `src/ui/screens/battle/{render,interaction}.ts` (ROG-51). Reuses the TUI's
 * pure `packEnemyColumns` layout helper and `BattleUiState` state machine
 * unmodified - the machine itself is already driven by
 * `BrowserKeyboardManager`'s `handleBattle` (ROG-45); this module only
 * changes how a battle looks (a keyed sprite/rect per enemy instead of
 * ASCII art, real `Text` menus instead of Ink boxes).
 *
 * Framework-free (no `pixi.js` import) behind a small `BattleDrawFactory`
 * interface, following `overworldView.ts`/`sceneView.ts`'s split so this is
 * unit-testable with a fake factory (see `battleView.test.ts`); the real
 * Pixi adapter lives in `pixiBattleDrawFactory.ts`.
 *
 * Turn feedback (floating damage numbers, a brief tint flash) is derived
 * entirely from HP deltas observed across successive `render()` calls, kept
 * as view-local instance state (`lastHp`/`floaters`/`flashes`) - the engine
 * has no floating-combat-text concept and must not grow one, since reducers
 * stay pure and `GameState` stays serializable. Aging/removing floaters and
 * reverting a flash is driven by `tick(deltaMS)`, which callers wire to a
 * Pixi `Ticker` once (see `main.ts`); it is deliberately just a linear alpha
 * fade plus a timed tint revert, not a general animation system.
 */

import { findShopItem } from "../../data/shops";
import {
  battleItemHealAmount,
  isBattleHealItem,
} from "../../engine/combat/resolution";
import { classSkills, type SkillDef } from "../../engine/combat/skills";
import type { BattleEnemy, BattleState } from "../../engine/combat/types";
import type { PartyMember } from "../../engine/entities/party";
import type { GameState } from "../../engine/state/types";
import {
  ACTIONS,
  type BattleMode,
  type BattleUiState,
} from "../../ui/screens/battle/interaction";
import { packEnemyColumns } from "../../ui/screens/battle/render";
import { theme, toPixiColor } from "../../ui/theme";

/** A positioned, destroyable draw primitive; every handle kind extends this. */
export interface DrawHandle {
  setPosition(x: number, y: number): void;
  destroy(): void;
}

/**
 * A positioned, texture-backed enemy sprite. `setSize` gives the real Pixi
 * adapter the square art box (see `ART_PX`) to fit the sprite's native
 * texture into, preserving aspect ratio - the three battler PNGs have
 * wildly different native sizes (`battlers.ts`), so the box, not the
 * texture's own pixel dimensions, is what stays consistent (ROG-63).
 */
export interface BattleSpriteHandle extends DrawHandle {
  setTexture(name: string): void;
  setSize(width: number, height: number): void;
  /** `0xffffff` (no tint) leaves the texture's own colors untouched. */
  setTint(color: number): void;
}

/** A solid rectangle - the sprite fallback, and the selection highlight. */
export interface BattleRectHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
}

/** A run of text; `width` is the rendered pixel width, used to size menu/header rows. */
export interface BattleTextHandle extends DrawHandle {
  setText(text: string): void;
  setColor(color: number): void;
  setAlpha(alpha: number): void;
  readonly width: number;
}

/** Renderer boundary this view draws through. */
export interface BattleDrawFactory {
  /** True when `name` is a real atlas frame; battles never break on a missing sprite (see module doc). */
  hasTexture(name: string): boolean;
  createSprite(): BattleSpriteHandle;
  createRect(): BattleRectHandle;
  createText(initialText: string): BattleTextHandle;
}

/** Pixel size of the region the view has to work with. */
export interface PixelSize {
  width: number;
  height: number;
}

/**
 * Pixel size of the square art box each enemy's sprite/rect is drawn into.
 * Battlers are their own scale class from the 8x8 tile atlas (loaded
 * individually by `battlers.ts`, see `pixiBattleDrawFactory.ts`'s module
 * doc), so this is just a fixed slot size for the battle layout, not tied
 * to any tile pitch.
 */
const ART_PX = 72;
const ENEMY_GAP_PX = 24;
const ROW_GAP_PX = 16;
const NAME_ROW_PX = 18;
const HP_ROW_PX = 16;
const COLUMN_HEIGHT_PX = ART_PX + NAME_ROW_PX + HP_ROW_PX;
const FIELD_PADDING_PX = 16;
/** Extra margin around the selected enemy's art for the target-mode highlight rect. */
const HIGHLIGHT_PAD_PX = 6;

const MENU_ROW_HEIGHT_PX = 18;
const MENU_PADDING_PX = 8;
/** Parked off-canvas so an unselected highlight rect never draws over anything. */
const HIGHLIGHT_PARK_Y = -10_000;

/** Floating damage-number lifetime and drift/flash timing (see module doc - deliberately minimal). */
const FLOATER_LIFE_MS = 700;
const FLOATER_DRIFT_PX_PER_MS = 0.04;
const FLASH_MS = 150;

/** One in-flight floating damage number. */
interface Floater {
  handle: BattleTextHandle;
  x: number;
  y: number;
  elapsed: number;
}

/** An enemy's art draw object - either a real sprite or the tinted-rect fallback. */
type ArtHandle =
  | { kind: "sprite"; handle: BattleSpriteHandle }
  | { kind: "rect"; handle: BattleRectHandle };

/** Selection/defeat/own-color priority, copied from `BattleScreen.tsx`'s `EnemyField`. */
function enemyDisplayColor(enemy: BattleEnemy, selected: boolean): string {
  if (enemy.hp <= 0) return theme.textFaint;
  if (selected) return theme.accent;
  return enemy.color ?? theme.text;
}

/**
 * Draws the enemy field (sprites/fallback rects + name/HP plates), a
 * target-mode selection highlight, the action/skill/item/target command
 * menu, and HP-delta-derived floating damage numbers / tint flashes.
 */
export class BattleSceneView {
  private readonly artHandles = new Map<string, ArtHandle>();
  private readonly nameHandles = new Map<string, BattleTextHandle>();
  private readonly hpHandles = new Map<string, BattleTextHandle>();
  private readonly normalTint = new Map<string, number>();
  /** Elapsed ms since a flash started, per combatant id; entry removed once reverted. */
  private readonly flashes = new Map<string, number>();
  /** Last-seen HP per combatant id (enemies plus the currently displayed party member). */
  private readonly lastHp = new Map<string, number>();
  private floaters: Floater[] = [];

  private targetHighlight: BattleRectHandle | undefined;
  private actorHeader: BattleTextHandle | undefined;
  private actorStatus: BattleTextHandle | undefined;
  private menuLines: BattleTextHandle[] = [];

  constructor(private readonly factory: BattleDrawFactory) {}

  /** Renders one frame from `state.battleState` and the live `battleUi` focus state (`keyboardManager.getState().battle`). */
  render(
    state: GameState,
    pixelSize: PixelSize,
    battleUi: BattleUiState,
  ): void {
    const bs = state.battleState;
    if (state.scene !== "battle" || !bs) return;

    const actor: PartyMember =
      state.party.find((member) => member.id === bs.activeMemberId) ??
      state.party[0];
    const knownSkills = classSkills(actor.classId);
    const healItems = state.inventory.filter((entryItem) =>
      isBattleHealItem(entryItem.itemId),
    );

    const menuRows = buildMenuRows(battleUi, actor, knownSkills, healItems);

    this.drawEnemies(bs, battleUi, pixelSize);
    this.drawActorStatus(actor, pixelSize, menuRows.length);
    this.drawMenu(menuRows, actor, pixelSize);
  }

  /** Ages/removes floating damage numbers and reverts any expired tint flash. Wire to a Pixi `Ticker` (see `main.ts`). */
  tick(deltaMS: number): void {
    const survivors: Floater[] = [];
    for (const floater of this.floaters) {
      floater.elapsed += deltaMS;
      const alpha = Math.max(0, 1 - floater.elapsed / FLOATER_LIFE_MS);
      if (alpha <= 0) {
        floater.handle.destroy();
        continue;
      }
      floater.handle.setAlpha(alpha);
      floater.handle.setPosition(
        floater.x,
        floater.y - floater.elapsed * FLOATER_DRIFT_PX_PER_MS,
      );
      survivors.push(floater);
    }
    this.floaters = survivors;

    for (const [id, elapsed] of [...this.flashes]) {
      const next = elapsed + deltaMS;
      if (next >= FLASH_MS) {
        this.flashes.delete(id);
        const tint = this.normalTint.get(id);
        if (tint !== undefined) this.applyTint(id, tint);
      } else {
        this.flashes.set(id, next);
      }
    }
  }

  private applyTint(id: string, color: number): void {
    const art = this.artHandles.get(id);
    if (!art) return;
    if (art.kind === "sprite") art.handle.setTint(color);
    else art.handle.setColor(color);
  }

  /** Records `hp` for `id` and, if it dropped since the last render, spawns a floater and starts a flash. */
  private checkDamage(id: string, hp: number, x: number, y: number): void {
    const prev = this.lastHp.get(id);
    if (prev !== undefined && hp < prev) {
      const handle = this.factory.createText("");
      handle.setText(`-${prev - hp}`);
      handle.setColor(toPixiColor(theme.danger));
      handle.setPosition(x, y);
      this.floaters.push({ handle, x, y, elapsed: 0 });
      this.flashes.set(id, 0);
    }
    this.lastHp.set(id, hp);
  }

  private drawEnemies(
    bs: BattleState,
    battleUi: BattleUiState,
    pixelSize: PixelSize,
  ): void {
    const aliveEnemies = bs.enemies.filter((enemy) => enemy.hp > 0);
    const packed = packEnemyColumns(
      bs.enemies,
      aliveEnemies,
      battleUi.mode === "target",
      battleUi.targetCursor,
      {
        columns: Math.max(ART_PX, pixelSize.width - FIELD_PADDING_PX * 2),
        gap: ENEMY_GAP_PX,
        rowGap: ROW_GAP_PX,
        artSize: { width: ART_PX, height: ART_PX },
      },
    );

    const seen = new Set<string>();
    let selected: { x: number; y: number } | undefined;

    let y = FIELD_PADDING_PX;
    for (const row of packed.rows) {
      let x = FIELD_PADDING_PX;
      for (const col of row) {
        seen.add(col.enemy.id);
        this.drawEnemyColumn(col.enemy, col.selected, x, y);
        if (col.selected) selected = { x, y };
        x += col.width + ENEMY_GAP_PX;
      }
      y += COLUMN_HEIGHT_PX + ROW_GAP_PX;
    }

    this.pruneEnemyHandles(seen);
    this.updateSelectionHighlight(selected);
  }

  private drawEnemyColumn(
    enemy: BattleEnemy,
    selected: boolean,
    x: number,
    y: number,
  ): void {
    this.checkDamage(enemy.id, enemy.hp, x + ART_PX / 2, y);

    const baseColor = toPixiColor(enemyDisplayColor(enemy, selected));
    this.normalTint.set(enemy.id, baseColor);
    const tint = this.flashes.has(enemy.id)
      ? toPixiColor(theme.danger)
      : baseColor;

    this.drawEnemyArt(enemy, x, y, tint);

    let name = this.nameHandles.get(enemy.id);
    if (!name) {
      name = this.factory.createText("");
      this.nameHandles.set(enemy.id, name);
    }
    name.setText(`${enemy.name}${enemy.hp <= 0 ? " (defeated)" : ""}`);
    name.setColor(tint);
    name.setPosition(x, y + ART_PX);

    let hp = this.hpHandles.get(enemy.id);
    if (!hp) {
      hp = this.factory.createText("");
      this.hpHandles.set(enemy.id, hp);
    }
    hp.setText(`HP ${enemy.hp}/${enemy.maxHp}`);
    hp.setColor(tint);
    hp.setPosition(x, y + ART_PX + NAME_ROW_PX);
  }

  /** Draws a real sprite when the atlas has one for `enemy.sprite`, else a tinted placeholder rect the same size. */
  private drawEnemyArt(
    enemy: BattleEnemy,
    x: number,
    y: number,
    tint: number,
  ): void {
    const useSprite = !!enemy.sprite && this.factory.hasTexture(enemy.sprite);
    const kind = useSprite ? "sprite" : "rect";
    const existing = this.artHandles.get(enemy.id);
    if (existing && existing.kind !== kind) {
      existing.handle.destroy();
      this.artHandles.delete(enemy.id);
    }

    let entry = this.artHandles.get(enemy.id);
    if (!entry) {
      entry =
        kind === "sprite"
          ? { kind: "sprite", handle: this.factory.createSprite() }
          : { kind: "rect", handle: this.factory.createRect() };
      this.artHandles.set(enemy.id, entry);
    }

    entry.handle.setPosition(x, y);
    if (entry.kind === "sprite") {
      entry.handle.setTexture(enemy.sprite as string);
      entry.handle.setSize(ART_PX, ART_PX);
      entry.handle.setTint(tint);
    } else {
      entry.handle.setSize(ART_PX, ART_PX);
      entry.handle.setColor(tint);
    }
  }

  private pruneEnemyHandles(seen: Set<string>): void {
    for (const [id, art] of this.artHandles) {
      if (!seen.has(id)) {
        art.handle.destroy();
        this.artHandles.delete(id);
        this.nameHandles.get(id)?.destroy();
        this.nameHandles.delete(id);
        this.hpHandles.get(id)?.destroy();
        this.hpHandles.delete(id);
        this.normalTint.delete(id);
        this.flashes.delete(id);
        this.lastHp.delete(id);
      }
    }
  }

  /** Positions the reusable highlight rect behind the selected enemy, or parks it off-canvas when nothing is selected. */
  private updateSelectionHighlight(
    selected: { x: number; y: number } | undefined,
  ): void {
    if (!this.targetHighlight) this.targetHighlight = this.factory.createRect();
    if (!selected) {
      this.targetHighlight.setPosition(0, HIGHLIGHT_PARK_Y);
      return;
    }
    this.targetHighlight.setPosition(
      selected.x - HIGHLIGHT_PAD_PX,
      selected.y - HIGHLIGHT_PAD_PX,
    );
    this.targetHighlight.setSize(
      ART_PX + HIGHLIGHT_PAD_PX * 2,
      ART_PX + HIGHLIGHT_PAD_PX * 2,
    );
    this.targetHighlight.setColor(toPixiColor(theme.accent));
  }

  /** Pixel y of the menu's top row (header row), anchoring both the menu and the actor status line above it. */
  private menuTopY(pixelSize: PixelSize, rowCount: number): number {
    return (
      pixelSize.height - (rowCount + 1) * MENU_ROW_HEIGHT_PX - MENU_PADDING_PX
    );
  }

  /** Draws the acting party member's nameplate/HP line, and tracks their HP for damage floaters. */
  private drawActorStatus(
    actor: PartyMember,
    pixelSize: PixelSize,
    menuRowCount: number,
  ): void {
    const x = FIELD_PADDING_PX;
    const y = this.menuTopY(pixelSize, menuRowCount) - MENU_ROW_HEIGHT_PX;

    this.checkDamage(actor.id, actor.hp, x + 40, y);

    const tint = this.flashes.has(actor.id)
      ? toPixiColor(theme.danger)
      : toPixiColor(theme.accent);
    this.normalTint.set(actor.id, toPixiColor(theme.accent));

    if (!this.actorStatus) this.actorStatus = this.factory.createText("");
    this.actorStatus.setText(
      `${actor.name}  HP ${actor.hp}/${actor.maxHp}  MP ${actor.mp}/${actor.maxMp}`,
    );
    this.actorStatus.setColor(tint);
    this.actorStatus.setPosition(x, y);
  }

  /** Destroys and recreates the menu's header + row text, matching `main.ts`'s existing precedent for small, infrequently-updated menus. */
  private drawMenu(
    rows: MenuRow[],
    actor: PartyMember,
    pixelSize: PixelSize,
  ): void {
    for (const line of this.menuLines) line.destroy();
    this.menuLines = [];

    const y = this.menuTopY(pixelSize, rows.length);
    const x = FIELD_PADDING_PX;

    if (!this.actorHeader) this.actorHeader = this.factory.createText("");
    this.actorHeader.setText(actor.name);
    this.actorHeader.setColor(toPixiColor(theme.accent));
    this.actorHeader.setPosition(x, y);

    for (const [index, row] of rows.entries()) {
      const handle = this.factory.createText("");
      handle.setText(row.text);
      handle.setColor(row.color);
      handle.setPosition(x, y + (index + 1) * MENU_ROW_HEIGHT_PX);
      this.menuLines.push(handle);
    }
  }
}

interface MenuRow {
  text: string;
  color: number;
}

/** Builds the command menu's text rows for the current mode, mirroring `BattleScreen.tsx`'s `ActionMenu` exactly. */
function buildMenuRows(
  battleUi: BattleUiState,
  actor: PartyMember,
  knownSkills: readonly SkillDef[],
  healItems: GameState["inventory"],
): MenuRow[] {
  const mode: BattleMode = battleUi.mode;

  if (mode === "skill") {
    return knownSkills.map((skill, index) => {
      const affordable = actor.mp >= skill.mpCost;
      const selected = index === battleUi.skillCursor;
      const color = selected
        ? toPixiColor(theme.accent)
        : affordable
          ? toPixiColor(theme.text)
          : toPixiColor(theme.textFaint);
      return {
        text: `${selected ? "> " : "  "}${skill.name} - ${skill.mpCost} MP${affordable ? "" : " (low MP)"}`,
        color,
      };
    });
  }

  if (mode === "item") {
    if (healItems.length === 0) {
      return [
        { text: "(no usable items)", color: toPixiColor(theme.textFaint) },
      ];
    }
    return healItems.map((item, index) => {
      const selected = index === battleUi.itemCursor;
      const name = findShopItem(item.itemId)?.name ?? item.itemId;
      return {
        text: `${selected ? "> " : "  "}${name} x${item.quantity} - heal ${battleItemHealAmount(item.itemId)}`,
        color: selected ? toPixiColor(theme.accent) : toPixiColor(theme.text),
      };
    });
  }

  if (mode === "target") {
    return [{ text: "Select a target", color: toPixiColor(theme.text) }];
  }

  return ACTIONS.map((action, index) => {
    const selected = index === battleUi.actionCursor;
    return {
      text: `${selected ? "> " : "  "}${action}`,
      color: selected ? toPixiColor(theme.accent) : toPixiColor(theme.text),
    };
  });
}
