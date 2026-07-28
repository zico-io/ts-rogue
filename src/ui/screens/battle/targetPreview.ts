import { resolveShapeTargets } from "../../../engine/combat/resolution";
import type { SkillDef, SkillTarget } from "../../../engine/combat/skills";
import { findSkill } from "../../../engine/combat/skills";
import type { BattleEnemy } from "../../../engine/combat/types";
import { Rng } from "../../../engine/rng/rng";
import type { BattleMode } from "./interaction";

// Never advanced against real game state - only randomN's branch of
// resolveShapeTargets rolls, and this preview never calls that branch (see
// previewSkillTargets below), so this instance's own state is inert.
const PREVIEW_RNG = new Rng(0);

const SHAPE_INDICATORS: Partial<Record<SkillTarget, string>> = {
  row: "Hits the whole row",
  column: "Hits this lane, front and back",
  allEnemies: "Hits everyone",
};

export interface ShapePreview {
  targetIds: readonly string[];
  indicator?: string;
}

// UI-side preview of a skill's target shape, built from the same
// resolveShapeTargets the engine uses for the real cast (ENG-28) so the
// highlight set shown before the player confirms can never drift from what
// actually gets hit. randomN is the one shape resolveShapeTargets can't
// preview deterministically - which target(s) it hits isn't decided until
// the real cast rolls - so it gets a count-based indicator instead of a
// highlight set.
export function previewSkillTargets(
  skill: SkillDef,
  enemies: readonly BattleEnemy[],
  anchorId: string,
): ShapePreview {
  if (skill.target === "randomN") {
    const aliveCount = enemies.filter((enemy) => enemy.hp > 0).length;
    const count = Math.min(skill.hitCount ?? 1, aliveCount);
    return {
      targetIds: [],
      indicator: `Hits ${count} random target${count === 1 ? "" : "s"}`,
    };
  }

  const targets = resolveShapeTargets(
    skill.target,
    enemies,
    anchorId,
    PREVIEW_RNG,
    skill.hitCount,
  );
  return {
    targetIds: targets.map((target) => target.id),
    indicator: SHAPE_INDICATORS[skill.target],
  };
}

export interface BattleHighlightParams {
  mode: BattleMode;
  knownSkills: readonly SkillDef[];
  skillCursor: number;
  pendingSkillId: string | null;
  targetCursor: number;
  enemies: readonly BattleEnemy[];
  aliveEnemies: readonly BattleEnemy[];
}

export interface BattleHighlight {
  highlightedIds: ReadonlySet<string>;
  indicator?: string;
}

// Single source of "what should light up on the enemy field right now" for
// BattleScreen. Row/column skills preview against the target cursor once
// the player is choosing a target (mirroring the unchanged single-target
// flow); allEnemies/randomN have no target cursor to move, so they preview
// as soon as the player is hovering them in the skill list, before the menu
// confirm that fires them immediately.
export function battleHighlight(
  params: BattleHighlightParams,
): BattleHighlight {
  const {
    mode,
    knownSkills,
    skillCursor,
    pendingSkillId,
    targetCursor,
    enemies,
    aliveEnemies,
  } = params;

  if (mode === "target") {
    const cursorEnemy = aliveEnemies[targetCursor];
    if (!cursorEnemy) return { highlightedIds: new Set() };
    const skill = pendingSkillId ? findSkill(pendingSkillId) : undefined;
    if (skill?.kind === "attack") {
      const preview = previewSkillTargets(skill, enemies, cursorEnemy.id);
      return {
        highlightedIds: new Set(preview.targetIds),
        indicator: preview.indicator,
      };
    }
    return { highlightedIds: new Set([cursorEnemy.id]) };
  }

  if (mode === "skill") {
    const skill = knownSkills[skillCursor];
    if (
      skill?.kind === "attack" &&
      (skill.target === "allEnemies" || skill.target === "randomN")
    ) {
      const preview = previewSkillTargets(
        skill,
        enemies,
        aliveEnemies[0]?.id ?? "",
      );
      return {
        highlightedIds: new Set(preview.targetIds),
        indicator: preview.indicator,
      };
    }
  }

  return { highlightedIds: new Set() };
}
