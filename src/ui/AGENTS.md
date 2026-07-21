# UI instructions

- Render `GameState` and dispatch typed engine events; do not duplicate game rules.
- Keep filesystem, network, save, and reporting I/O outside reducers.
- Use the shared `Screen` frame and terminal layout context for gameplay scenes.
- Keep render helpers pure and test them at supported terminal sizes.
- Preserve the 64x24 minimum-size fallback and basic keyboard accessibility.
- Reproduce visual changes in the real tmux play harness and inspect the frame.
- Keep TypeScript relative imports extensionless.
- Update `README.md` when controls, scenes, layout, or diagnostics change.
