import { findShopItem } from "../../data/shops";
import { memberSkills, type SkillDef } from "../../engine/combat/skills";
import type { Element } from "../../engine/combat/statusEffects";
import type { BattleEnemy, BattleState } from "../../engine/combat/types";
import type { PartyMember } from "../../engine/entities/party";
import {
  battleItemEffectLabel,
  isUsableBattleItem,
} from "../../engine/loot/consumables";
import type { GameState } from "../../engine/state/types";
import {
  ACTIONS,
  type BattleMode,
  type BattleUiState,
} from "../../ui/screens/battle/interaction";
import { packEnemyColumns } from "../../ui/screens/battle/render";
import { theme, toPixiColor } from "../../ui/theme";
import { ParticleField, type ParticleHandle } from "./particles";

export interface DrawHandle {
  setPosition(x: number, y: number): void;
  destroy(): void;
}

export interface BattleSpriteHandle extends DrawHandle {
  setTexture(name: string): void;
  setSize(width: number, height: number): void;

  setTint(color: number): void;
}

export interface BattleRectHandle extends DrawHandle {
  setSize(width: number, height: number): void;
  setColor(color: number): void;
}

export interface BattleTextHandle extends DrawHandle {
  setText(text: string): void;
  setColor(color: number): void;
  setAlpha(alpha: number): void;
  readonly width: number;
}

export interface BattleDrawFactory {
  hasTexture(name: string): boolean;
  createSprite(): BattleSpriteHandle;
  createRect(): BattleRectHandle;
  createText(initialText: string): BattleTextHandle;
  createParticle(): ParticleHandle;
}

export interface PixelSize {
  width: number;
  height: number;
}

const MIN_ART_PX = 72;
const MAX_ART_PX = 144;

const ART_HEIGHT_RATIO = 0.3;

export function artPxFor(pixelSize: PixelSize): number {
  return Math.max(
    MIN_ART_PX,
    Math.min(MAX_ART_PX, Math.round(pixelSize.height * ART_HEIGHT_RATIO)),
  );
}

const ENEMY_GAP_PX = 24;
const ROW_GAP_PX = 16;
const NAME_ROW_PX = 18;
const HP_ROW_PX = 16;
const FIELD_PADDING_PX = 16;

const HIGHLIGHT_PAD_PX = 6;

const MENU_ROW_HEIGHT_PX = 18;
const MENU_PADDING_PX = 8;

const HIGHLIGHT_PARK_Y = -10_000;

const FLOATER_LIFE_MS = 700;
const FLOATER_DRIFT_PX_PER_MS = 0.04;
const FLASH_MS = 150;

// Effects (WEB-7). Keyed effects are procedural particle bursts today, not
// yet the pre-animated Minifantasy sprite sheets ART_DIRECTION.md §6 calls
// for - those sheets aren't vendored (see assets/README.md) - but they sit
// behind the same BattleDrawFactory seam, so swapping in real frames later
// is a factory change, not a view rewrite.
const BURST_PARTICLE_CAP = 48;

const SPELL_BURST_COUNT = 10;
const SPELL_BURST_SPEED_PX_PER_MS = 0.12;
const SPELL_BURST_LIFE_MS = 420;
const SPELL_BURST_SIZE_PX = 4;
const SPELL_BURST_GRAVITY = 0.00015;

const MELEE_SPARK_COUNT = 5;
const MELEE_SPARK_SPEED_PX_PER_MS = 0.16;
const MELEE_SPARK_LIFE_MS = 220;
const MELEE_SPARK_SIZE_PX = 3;
// A narrow forward-facing arc reads as a slash rather than an explosion.
const MELEE_ARC_RADIANS = Math.PI / 2;

const HEAL_SPARK_COUNT = 5;
const HEAL_SPARK_RISE_PX_PER_MS = 0.05;
const HEAL_SPARK_LIFE_MS = 550;
const HEAL_SPARK_SIZE_PX = 3;
const HEAL_SPARK_SPREAD_PX = 24;

const SHAKE_MAGNITUDE_PX = 3;
const SHAKE_FREQUENCY = 0.9;

const TAU = Math.PI * 2;

interface Floater {
  handle: BattleTextHandle;
  x: number;
  y: number;
  elapsed: number;
}

type ArtHandle =
  | { kind: "sprite"; handle: BattleSpriteHandle }
  | { kind: "rect"; handle: BattleRectHandle };

function enemyDisplayColor(enemy: BattleEnemy, selected: boolean): string {
  if (enemy.hp <= 0) return theme.textFaint;
  if (selected) return theme.accent;
  return enemy.color ?? theme.text;
}

export class BattleSceneView {
  private readonly artHandles = new Map<string, ArtHandle>();
  private readonly nameHandles = new Map<string, BattleTextHandle>();
  private readonly hpHandles = new Map<string, BattleTextHandle>();
  private readonly normalTint = new Map<string, number>();

  private readonly flashes = new Map<string, number>();

  private readonly lastHp = new Map<string, number>();
  private floaters: Floater[] = [];

  private readonly bursts: ParticleField;
  private reducedMotion = false;
  private logCursor: number | undefined;
  private pendingElement: Element | undefined;

  private artPx = MIN_ART_PX;

  private targetHighlight: BattleRectHandle | undefined;
  private actorHeader: BattleTextHandle | undefined;
  private actorStatus: BattleTextHandle | undefined;
  private menuLines: BattleTextHandle[] = [];

  constructor(private readonly factory: BattleDrawFactory) {
    this.bursts = new ParticleField(factory, BURST_PARTICLE_CAP);
  }

  render(
    state: GameState,
    pixelSize: PixelSize,
    battleUi: BattleUiState,
  ): void {
    const bs = state.battleState;
    if (state.scene !== "battle" || !bs) return;

    this.capturePendingElement(state.log);

    this.artPx = artPxFor(pixelSize);

    const actor: PartyMember =
      state.party.find((member) => member.id === bs.activeMemberId) ??
      state.party[0];
    const knownSkills = memberSkills(actor);
    const usableItems = state.inventory.filter((entryItem) =>
      isUsableBattleItem(entryItem.itemId),
    );

    const menuRows = buildMenuRows(battleUi, actor, knownSkills, usableItems);

    this.drawEnemies(bs, battleUi, pixelSize);
    this.drawActorStatus(actor, pixelSize, menuRows.length);
    this.drawMenu(menuRows, actor, pixelSize);
  }

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

    this.bursts.tick(deltaMS);
  }

  /** Numerals, name/HP text, and hit-flash tint stay - only the additive
   * particle effects and hit-shake are removed, per ART_DIRECTION.md §6's
   * "additive and prefers-reduced-motion-gated" guardrail. */
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) this.bursts.clear();
  }

  private capturePendingElement(log: GameState["log"]): void {
    if (this.logCursor === undefined) {
      // First render: don't react to log history from before this view
      // existed (e.g. resuming a save mid-battle).
      this.logCursor = log.length;
      this.pendingElement = undefined;
      return;
    }
    this.pendingElement =
      log.length > this.logCursor
        ? log
            .slice(this.logCursor)
            .find((line) => line.kind === "damage" && line.element)?.element
        : undefined;
    this.logCursor = log.length;
  }

  private consumePendingElement(): Element {
    const element = this.pendingElement ?? "physical";
    this.pendingElement = undefined;
    return element;
  }

  private spawnHitBurst(x: number, y: number, element: Element): void {
    if (this.reducedMotion) return;
    const color = toPixiColor(theme.element[element]);
    if (element === "physical") {
      for (let i = 0; i < MELEE_SPARK_COUNT; i++) {
        const angle =
          -MELEE_ARC_RADIANS / 2 +
          (i / Math.max(1, MELEE_SPARK_COUNT - 1)) * MELEE_ARC_RADIANS;
        this.bursts.spawn({
          x,
          y,
          vx: Math.cos(angle) * MELEE_SPARK_SPEED_PX_PER_MS,
          vy: Math.sin(angle) * MELEE_SPARK_SPEED_PX_PER_MS,
          size: MELEE_SPARK_SIZE_PX,
          color,
          lifeMs: MELEE_SPARK_LIFE_MS,
        });
      }
      return;
    }
    for (let i = 0; i < SPELL_BURST_COUNT; i++) {
      const angle = (i / SPELL_BURST_COUNT) * TAU;
      this.bursts.spawn({
        x,
        y,
        vx: Math.cos(angle) * SPELL_BURST_SPEED_PX_PER_MS,
        vy: Math.sin(angle) * SPELL_BURST_SPEED_PX_PER_MS,
        gravity: SPELL_BURST_GRAVITY,
        size: SPELL_BURST_SIZE_PX,
        color,
        lifeMs: SPELL_BURST_LIFE_MS,
      });
    }
  }

  private spawnHealSparkle(x: number, y: number): void {
    if (this.reducedMotion) return;
    const color = toPixiColor(theme.heal);
    for (let i = 0; i < HEAL_SPARK_COUNT; i++) {
      const spread =
        (i / Math.max(1, HEAL_SPARK_COUNT - 1) - 0.5) * HEAL_SPARK_SPREAD_PX;
      this.bursts.spawn({
        x: x + spread,
        y,
        vy: -HEAL_SPARK_RISE_PX_PER_MS,
        size: HEAL_SPARK_SIZE_PX,
        color,
        lifeMs: HEAL_SPARK_LIFE_MS,
      });
    }
  }

  private shakeOffset(id: string): number {
    if (this.reducedMotion) return 0;
    const elapsed = this.flashes.get(id);
    if (elapsed === undefined) return 0;
    const decay = 1 - elapsed / FLASH_MS;
    return Math.sin(elapsed * SHAKE_FREQUENCY) * SHAKE_MAGNITUDE_PX * decay;
  }

  private applyTint(id: string, color: number): void {
    const art = this.artHandles.get(id);
    if (!art) return;
    if (art.kind === "sprite") art.handle.setTint(color);
    else art.handle.setColor(color);
  }

  private checkDamage(
    id: string,
    hp: number,
    x: number,
    y: number,
    kind: "enemy" | "actor",
  ): void {
    const prev = this.lastHp.get(id);
    if (prev !== undefined) {
      if (hp < prev) {
        const handle = this.factory.createText("");
        handle.setText(`-${prev - hp}`);
        handle.setColor(toPixiColor(theme.danger));
        handle.setPosition(x, y);
        this.floaters.push({ handle, x, y, elapsed: 0 });
        this.flashes.set(id, 0);
        this.spawnHitBurst(
          x,
          y,
          kind === "enemy" ? this.consumePendingElement() : "physical",
        );
      } else if (hp > prev && kind === "actor") {
        this.spawnHealSparkle(x, y);
      }
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
        columns: Math.max(this.artPx, pixelSize.width - FIELD_PADDING_PX * 2),
        gap: ENEMY_GAP_PX,
        rowGap: ROW_GAP_PX,
        artSize: { width: this.artPx, height: this.artPx },
      },
    );

    const startX = Math.max(
      FIELD_PADDING_PX,
      (pixelSize.width - packed.fieldWidth) / 2,
    );
    const columnHeight = this.artPx + NAME_ROW_PX + HP_ROW_PX;

    const seen = new Set<string>();
    let selected: { x: number; y: number } | undefined;

    let y = FIELD_PADDING_PX;
    for (const row of packed.rows) {
      let x = startX;
      for (const col of row) {
        seen.add(col.enemy.id);
        this.drawEnemyColumn(col.enemy, col.selected, x, y);
        if (col.selected) selected = { x, y };
        x += col.width + ENEMY_GAP_PX;
      }
      y += columnHeight + ROW_GAP_PX;
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
    this.checkDamage(enemy.id, enemy.hp, x + this.artPx / 2, y, "enemy");

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
    name.setPosition(x, y + this.artPx);

    let hp = this.hpHandles.get(enemy.id);
    if (!hp) {
      hp = this.factory.createText("");
      this.hpHandles.set(enemy.id, hp);
    }
    hp.setText(`HP ${enemy.hp}/${enemy.maxHp}`);
    hp.setColor(tint);
    hp.setPosition(x, y + this.artPx + NAME_ROW_PX);
  }

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

    const shakeX = this.shakeOffset(enemy.id);
    entry.handle.setPosition(x + shakeX, y);
    if (entry.kind === "sprite") {
      entry.handle.setTexture(enemy.sprite as string);
      entry.handle.setSize(this.artPx, this.artPx);
      entry.handle.setTint(tint);
    } else {
      entry.handle.setSize(this.artPx, this.artPx);
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
      this.artPx + HIGHLIGHT_PAD_PX * 2,
      this.artPx + HIGHLIGHT_PAD_PX * 2,
    );
    this.targetHighlight.setColor(toPixiColor(theme.accent));
  }

  private menuTopY(pixelSize: PixelSize, rowCount: number): number {
    return (
      pixelSize.height - (rowCount + 1) * MENU_ROW_HEIGHT_PX - MENU_PADDING_PX
    );
  }

  private drawActorStatus(
    actor: PartyMember,
    pixelSize: PixelSize,
    menuRowCount: number,
  ): void {
    const x = FIELD_PADDING_PX;
    const y = this.menuTopY(pixelSize, menuRowCount) - MENU_ROW_HEIGHT_PX;

    this.checkDamage(actor.id, actor.hp, x + 40, y, "actor");

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

function buildMenuRows(
  battleUi: BattleUiState,
  actor: PartyMember,
  knownSkills: readonly SkillDef[],
  usableItems: GameState["inventory"],
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
    if (usableItems.length === 0) {
      return [
        { text: "(no usable items)", color: toPixiColor(theme.textFaint) },
      ];
    }
    return usableItems.map((item, index) => {
      const selected = index === battleUi.itemCursor;
      const name = findShopItem(item.itemId)?.name ?? item.itemId;
      return {
        text: `${selected ? "> " : "  "}${name} x${item.quantity} - ${battleItemEffectLabel(item.itemId)}`,
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
