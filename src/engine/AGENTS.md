# Engine instructions

- Keep this directory independent from `src/ui` and all rendering concerns.
- Keep `GameState` JSON-serializable and reducers pure.
- Route every random outcome through serialized seeded RNG state.
- Make rejected actions side-effect-free, including RNG and log state.
- Put external I/O in the application, UI, or persistence boundary.
- Change typed definitions in `src/data` rather than duplicating content in engine code.
- Add one deterministic test for every non-trivial rule change.
- Update `README.md` when shipped engine behavior or invariants change.
