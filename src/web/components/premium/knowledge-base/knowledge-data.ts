export type KnowledgeSection = {
  title: string;
  body: string;
  steps?: string[];
};
export type KnowledgeArticle = {
  id: string;
  title: string;
  description: string;
  category: string;
  readingMinutes: number;
  sections: KnowledgeSection[];
};
export const KNOWLEDGE_ARTICLES: readonly KnowledgeArticle[] = [
  {
    id: "the-run-loop",
    title: "The shape of a run",
    description:
      "Village, overworld, dungeon, battle, and back again with the loot.",
    category: "Getting started",
    readingMinutes: 3,
    sections: [
      {
        title: "Five places, one circle",
        body: "A run starts in the village and moves outward. You cross the overworld to a dungeon entrance, descend into first-person corridors, fight turn-based battles, and carry the rewards home. Every stage feeds the next one, so nothing you pick up is wasted.",
        steps: [
          "Leave the village and cross the overworld to a dungeon entrance.",
          "Descend, clear rooms and chests, and find the stairs down.",
          "Beat the boss floor, then return to the village to rest, sell, and save.",
        ],
      },
      {
        title: "Every run is a seed",
        body: "The world is generated from a seed, and every random outcome comes from that seed's number generator. The same seed produces the same overworld and the same dungeon layouts, which makes a run reproducible and a bug worth reporting.",
      },
      {
        title: "Blocked moves cost nothing",
        body: "An action the rules reject is side-effect free and consumes no randomness. Walking into a wall or casting a skill you cannot afford leaves the run exactly where it was, so you can probe the edges of a situation without spending your luck.",
      },
    ],
  },
  {
    id: "choosing-a-class",
    title: "Choosing a class",
    description: "Warrior, Rogue, and Wizard, and what each one grows into.",
    category: "Getting started",
    readingMinutes: 3,
    sections: [
      {
        title: "Three starting shapes",
        body: "Warrior, Rogue, and Wizard each define starting stats, per-level growth, and the skills a member already knows. The class you pick also decides which skill tree you spend points in for the rest of the run.",
      },
      {
        title: "Class picks your tree",
        body: "Each class points at one skill tree. You cannot spend a point on another class's node, so the class choice at the start of a run is also a choice about which passives and active skills you will have at the end of it.",
      },
    ],
  },
  {
    id: "controls-and-scenes",
    title: "Controls and scenes",
    description: "Moving, selecting, and getting back out of a menu.",
    category: "Getting started",
    readingMinutes: 2,
    sections: [
      {
        title: "The keys",
        body: "Arrow keys move and navigate menus, Enter selects, and Escape backs out of whatever is open. In the browser portal the number keys 1 through 4 jump between scenes.",
        steps: [
          "Arrow keys: move on the map, move the cursor in a menu.",
          "Enter: confirm the highlighted option.",
          "Escape: close the current menu or step back one level.",
        ],
      },
      {
        title: "Terminal or browser",
        body: "The same engine runs behind the Ink terminal build and the PixiJS browser portal. Controls and rules match; only the renderer changes.",
      },
    ],
  },
  {
    id: "battle-actions",
    title: "Battle actions",
    description: "Attack, Skill, Item, Defend, and Flee in initiative order.",
    category: "Combat",
    readingMinutes: 4,
    sections: [
      {
        title: "One round, one order",
        body: "Each round resolves in a fixed initiative order. On a member's turn you choose Attack, Skill, Item, Defend, or Flee, and the round plays out before anyone acts again.",
        steps: [
          "Attack: a basic strike against one reachable enemy.",
          "Skill: spend MP on an active skill with its own element and target shape.",
          "Item: use a consumable from the shared inventory.",
          "Defend: reduce incoming damage until your next turn.",
          "Flee: attempt to leave the fight.",
        ],
      },
      {
        title: "Front row blocks the back",
        body: "Enemies stand in a front row and a back row; your party stays a flat line. A basic attack cannot reach a back-row enemy while any front-row enemy is still alive. Skills ignore that rule entirely and reach any row directly, which is often the reason to spend MP on a fight you could win with attacks.",
      },
      {
        title: "Every target rolls its own dice",
        body: "A skill that hits several enemies is not one roll broadcast to the group. Each resolved target rolls its own critical hit, its own damage, and its own chance to catch a status effect.",
      },
    ],
  },
  {
    id: "elements-and-status",
    title: "Elements and status effects",
    description: "Poison, burn, stun, and the rest, and how to clear them.",
    category: "Combat",
    readingMinutes: 4,
    sections: [
      {
        title: "What can stick to you",
        body: "Skills and monster attacks carry an element and may apply a status effect: poison, burn, stun, slow, wet, oiled, chilled, frozen, or shocked. Effects tick at the start of the afflicted actor's turn.",
      },
      {
        title: "Clearing them",
        body: "Antidote cures poison and Thermal Salts cure burn and chilled. Every Heal-kind skill also cleanses the caster's own status effects on cast, so a healer can often dig themselves out without spending an item.",
        steps: [
          "Antidote: cures poison.",
          "Thermal Salts: cures burn and chilled.",
          "Any Heal skill: cleanses the caster's own effects as it heals.",
        ],
      },
      {
        title: "Battle ends, effects end",
        body: "Status effects are cleared entirely when a battle ends. Nothing carries out of the fight, so a rough win costs you HP and MP but never a lingering condition.",
      },
    ],
  },
  {
    id: "target-shapes",
    title: "Skill target shapes",
    description: "Single, row, column, all, and random targeting explained.",
    category: "Combat",
    readingMinutes: 3,
    sections: [
      {
        title: "The shapes",
        body: "Every skill declares a target shape, and one resolver turns that shape into a concrete list of targets for both your commands and monster turns.",
        steps: [
          "single: one chosen target.",
          "row: every living enemy sharing the anchor's row.",
          "column: pierces the anchor's lane through both rows.",
          "allEnemies / allAllies: everyone living on that side.",
          "randomN: a set number of distinct living targets, chosen without replacement.",
          "self / ally: the caster, or one chosen party member.",
        ],
      },
      {
        title: "Monsters use the same rules",
        body: "A monster carrying an attack-kind skill always casts one instead of a basic attack. The Dungeon Guardian's Cleave and Meteor resolve through exactly the same targeting code your party uses.",
      },
    ],
  },
  {
    id: "defeat-and-permadeath",
    title: "Defeat, revival, and permadeath",
    description: "What a wipe costs you, and when a run is actually over.",
    category: "Combat",
    readingMinutes: 2,
    sections: [
      {
        title: "Normal defeat",
        body: "A normal defeat revives the party in the village with one HP and half its gold. The run continues; the loss is money and position, not progress.",
      },
      {
        title: "Permadeath",
        body: "Permadeath marks the run as over, clears the active battle and dungeon, and the saved game is discarded. There is nothing to reload, so the next run starts from a new seed.",
      },
    ],
  },
  {
    id: "overworld-travel",
    title: "Crossing the overworld",
    description:
      "Biomes, the village, dungeon entrances, and the encounter meter.",
    category: "Exploration",
    readingMinutes: 3,
    sections: [
      {
        title: "What is out there",
        body: "The overworld holds passable biomes, the village, reachable dungeon entrances, and a seeded encounter meter that fills as you walk. Layouts are reproducible from the seed, so a route that worked once works again.",
      },
      {
        title: "The village footprint",
        body: "The village covers a two-by-two block of cells rather than a single tile. Every covered cell carries the village tile, so you can walk in from any of the four sides and the entry trigger fires the same way.",
      },
      {
        title: "Reading a dungeon entrance",
        body: "Stepping onto a story dungeon's entrance logs its name and its recommended level instead of a generic descend message. Read that line before you commit; the recommendation is the cheapest warning in the game.",
      },
    ],
  },
  {
    id: "fast-travel",
    title: "Evac and zoom",
    description: "Leaving a dungeon and hopping between places you have been.",
    category: "Exploration",
    readingMinutes: 2,
    sections: [
      {
        title: "Evac",
        body: "Evac leaves any dungeon for the overworld, placing you on that dungeon's entrance tile without touching your progress inside it. It is unavailable during a battle.",
      },
      {
        title: "Zoom",
        body: "Zoom teleports between landmarks you have already visited this run, meaning the village and any dungeon entrance you have stood on.",
      },
      {
        title: "Neither costs you a fight",
        body: "Fast travel does not trigger an encounter and does not advance the encounter meter. Walking a long route back is a choice, not a requirement.",
      },
    ],
  },
  {
    id: "inside-a-dungeon",
    title: "Inside a dungeon",
    description: "Rooms, corridors, chests, stairs, and the boss floor.",
    category: "Exploration",
    readingMinutes: 3,
    sections: [
      {
        title: "Deterministic floors",
        body: "Each dungeon generates deterministic rooms and corridors with chests, stairs, wandering encounters, and a boss floor at the bottom. The same seed lays out the same dungeon every time.",
      },
      {
        title: "Working a floor",
        body: "Clear what you can afford to clear, then take the stairs. Chests and wandering encounters both feed the loot and experience you will need on the boss floor, but MP does not refill on its own down there.",
      },
    ],
  },
  {
    id: "skill-trees",
    title: "Skill trees and points",
    description:
      "Earning points, spending them, and what a node actually does.",
    category: "Progression",
    readingMinutes: 4,
    sections: [
      {
        title: "Earning points",
        body: "Each level gained awards one skill point on top of the usual stat and HP/MP growth. Points are awarded going forward only; levels reached before skill trees existed in a save are not paid out retroactively.",
      },
      {
        title: "Spending them",
        body: "A point unlocks a node on your class's tree. The attempt is rejected, with a reason, if the node is unknown, already unlocked, missing a prerequisite, or you cannot afford it. A rejected unlock changes nothing.",
        steps: [
          "Open the skill tree and pick a node whose prerequisites you already hold.",
          "Confirm the unlock to spend one point.",
          "Active nodes appear in the battle Skill menu; passive nodes apply immediately.",
        ],
      },
      {
        title: "Active versus passive",
        body: "An active node's skill is added to your battle skill list alongside the skills your class already knows. A passive node's stat delta is added on top of your base stats and equipment, so attack, defense, and speed all pick it up automatically.",
      },
    ],
  },
  {
    id: "guild-quests",
    title: "The Guild quest board",
    description: "Accepting up to three quests, and how each kind completes.",
    category: "Progression",
    readingMinutes: 4,
    sections: [
      {
        title: "Three at a time",
        body: "The Guild board lets you hold up to three accepted quests at once. Turning one in pays out gold, experience, and item rewards. Refreshing the board repopulates it from quests your party's level qualifies for and that you have not already taken or completed.",
      },
      {
        title: "How each kind advances",
        body: "Accepted quests advance on victory, inside the same step that finalizes a won battle.",
        steps: [
          "Kill quests tally defeated enemies of the matching kind, capped at the target count.",
          "Clear quests complete on a boss victory in the matching dungeon.",
          "Fetch quests roll their drop chance and add the item to your quest items.",
        ],
      },
      {
        title: "Only for quests you took",
        body: "A fetch quest only rolls its drop for kills that an incomplete, accepted quest still needs. No randomness is spent on quests nobody has taken, which is also why accepting before you farm matters.",
      },
    ],
  },
  {
    id: "loot-and-equipment",
    title: "Loot and equipment",
    description: "Bases, rarity, affixes, and monster-specific drops.",
    category: "Progression",
    readingMinutes: 3,
    sections: [
      {
        title: "How an item is built",
        body: "Loot combines an item base, a rarity, a prefix, a suffix, and sometimes a monster-specific implicit property. The same monster can therefore drop the same base twice and give you two quite different items.",
      },
      {
        title: "Effective stats",
        body: "A member's effective stats are their base stats, plus equipment, plus every unlocked passive skill node. Compare a new piece against that total rather than against the raw number on the item.",
      },
    ],
  },
  {
    id: "village-and-saving",
    title: "The village and saving",
    description: "Resting, buying, selling, and where a save actually lives.",
    category: "Progression",
    readingMinutes: 2,
    sections: [
      {
        title: "What the village is for",
        body: "The village covers resting, buying, selling, and equipment changes. It is the one place a run reliably recovers, so plan the return trip before your MP runs out rather than after.",
      },
      {
        title: "One slot, whole state",
        body: "Saving writes the complete game state to a single slot. Older supported saves are backfilled on load with the required run flags, the default Warrior class, and zero skill points and unlocked nodes.",
      },
    ],
  },
];

export function searchKnowledge(
  articles: readonly KnowledgeArticle[],
  query: string,
) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    const text = [
      article.title,
      article.description,
      article.category,
      ...article.sections.flatMap((section) => [
        section.title,
        section.body,
        ...(section.steps ?? []),
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
