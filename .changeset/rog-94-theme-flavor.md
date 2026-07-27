---
"ts-rogue": minor
---

Theme flavor in the first-person renderer and message log (ROG-94). Each
dungeon's active theme (`DungeonDef.theme`, `src/data/dungeons.ts`) now
travels with its `DungeonState` as plain data, and both the Ink terminal
renderer and the PixiJS web renderer key their first-person wall/depth-band
color ramp off that theme id (`dungeonRamp`, `src/ui/theme.ts`) instead of the
dungeon's arbitrary waypoint index - so the crypt, cave, and ruins story
dungeons each read as a distinct palette (cool teal, indigo, and warm ember
respectively) once entrance-to-dungeon assignment (ROG-90) routes players to
the real defs. A dungeon id that isn't yet mapped to a def falls back to the
first story def's theme, so every dungeon renders with a real accent today.

Entering a dungeon and descending a floor now emit theme-specific
message-log flavor lines (`dungeonEntryFlavor`/`dungeonDescendFlavor`) instead
of one generic line, so each theme also has a distinct voice in the log.
