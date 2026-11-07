---
'coily': patch
---

Fix a duplicate update when reduced motion turns on. A spring that
followed a moving spring got two `update` events as it snapped. A
follower that started moving before its leader also snapped twice, the
first time to a stale target. Each spring now snaps once, to its final
target, with one `update` and one `stop`.
