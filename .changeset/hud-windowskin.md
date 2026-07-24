---
"ts-rogue": minor
---

HUD typography, spacing, and information hierarchy in the browser renderer
(ROG-64): the PixiJS HUD chrome now draws as a beveled navy `window`-token
panel with an amber frame, HP/MP meters gain a bevel and gloss line, a
title-divider hairline separates the title from the body, and the message
log fades older lines toward the window fill. Chrome text now renders with a
vendored Silkscreen bitmap pixel font (Pixi `BitmapFont`) instead of the
canvas `monospace` fallback, falling back gracefully if the font fails to
load. Terminal renderer (`pnpm game`) is unaffected.
