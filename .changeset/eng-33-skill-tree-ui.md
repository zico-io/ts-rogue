---
"ts-rogue": minor
---

Skill tree UI: view nodes/prerequisites, spend points (ENG-33). A new Skill
Tree screen (Shift+K, anywhere outside battle) lists the active party
member's class tree: every node's name, cost, and prerequisites, its
locked/unlockable/unlocked state, and the member's unspent skill points.
Confirming an unlockable node spends a point through the existing
`unlockSkillNode` action and the list re-renders immediately; a locked or
already-unlocked node cannot be confirmed, so an invalid spend attempt is not
reachable from the UI. Left/Right switches party member.

This is a dedicated hotkey entry point standing in for the character sheet
(ROG-18, still Backlog) - it should fold into that screen once ROG-18 ships.

`SKILL_TREES` is still empty pending starter tree content (ENG-35), so every
real class currently shows "no skill tree yet" until that lands.
