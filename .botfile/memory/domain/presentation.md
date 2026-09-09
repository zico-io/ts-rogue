# Presentation

Rendering and screen-level facts for the Ink terminal UI, which the browser
also runs over a PTY. Part of the golden product SSOT (see
`.botfile/memory/index.md`); `pnpm docs:lint` reports drift.

- The first-person dungeon view renders perspective-projected wall faces and interactables as Braille wireframes. <source: src/ui/screens/dungeon/render.ts, 2026-07-23>
- The terminal UI ships a visual identity: a shared theme-token palette and an image tileset overlay. <source: src/ui/README.md and src/ui/tiles, 2026-07-23>
- A Character Sheet screen (Shift+C, anywhere outside battle) shows the current party member's name, class, level, XP/XP-to-next, core stats with the equipment bonus broken out (base+bonus=total via `effectiveStats`), derived ATK/DEF/SPD, all four equipment slots, and known skills with MP costs; Left/Right switches party member and Esc returns to the scene it was opened from. It is pure display (no engine changes) and reuses `EQUIP_SLOTS` from the village Store view. Unspent skill points shows a static 0 placeholder until skill trees ship. <source: src/ui/screens/CharacterSheetScreen.tsx and src/ui/screens/character/interaction.ts, 2026-07-27>
- A Skill Tree screen (Shift+K, anywhere outside battle) lists the active party member's class-tree nodes (name, cost, prerequisites, and locked/unlockable/unlocked state) plus their unspent skill points; confirming an unlockable node dispatches `UnlockSkillNode` and the list re-renders immediately from the updated `PartyMember`. Left/Right switches party member and Esc returns to the scene it was opened from. It reuses the `StoreView` cursor-list/color convention rather than a new list primitive. This is a standalone hotkey entry point, not yet folded into the Character Sheet (ROG-18 is still Backlog); that fold-in, and real content, are follow-ups (ROG-18, ENG-35). <source: src/ui/screens/SkillTreeScreen.tsx and src/ui/screens/skillTree/interaction.ts, 2026-07-28>
