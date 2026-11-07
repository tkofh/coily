---
'coily': patch
---

`system.advance(dt)` now throws on a negative `dt`. Before, a negative `dt`
ran the clock backward and rewound springs, though the clock is meant to
move only forward. A `dt` of 0 is still allowed.
