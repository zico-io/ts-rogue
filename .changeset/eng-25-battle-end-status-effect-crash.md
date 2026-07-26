---
"ts-rogue": patch
---

Fix a crash that hit every battle once any status effect (poison, wet, etc.)
had ever been applied: clearing an actor's `effects` field on battle end
(win/lose/flee) or on effect expiry assigned it the literal value `undefined`,
which failed the engine's stricter-than-JSON serialization check and threw an
unrecoverable "Unexpected game failure" screen. The field is now removed from
the object instead of set to `undefined`.

Also fixes reapplying an already-active status effect (e.g. hitting a poisoned
target with another poison-applying attack) creating a second, independently
ticking effect instance instead of refreshing the existing one's duration.
