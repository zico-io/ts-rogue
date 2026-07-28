# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task — if a pattern exists, follow it.

<!-- Each row maps a pattern file (or section) to when the agent should load it.
     Simple form: one row per file. Anchored form (multi-section files): one
     row per task using a "file.md#task-name" anchor link.
     Keep the table sorted alphabetically. One row per task (not per file).
     If you add a pattern, add a row; if you delete one, remove its row. -->

| Pattern | Use when |
|---------|----------|
| [add-content.md](add-content.md) | Adding a monster/item/tile to `src/data` and its browser sprite via the atlas |
| [add-game-event.md](add-game-event.md) | Adding a new player action / state transition (GameEvent + reduce case) |
| [add-skill.md](add-skill.md) | Adding a combat skill or a skill-tree node (target shape, passive stats) |
| [debug-renderer-divergence.md](debug-renderer-divergence.md) | A change works in one renderer but breaks the other, or trips import guardrails |
