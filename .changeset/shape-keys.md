---
'coily': patch
---

Composite shapes handle keys that their dot paths cannot tell apart.

- A key containing a dot no longer shares its `purpose` with the nested
  path it spells: in `{ 'a.b': 0, a: { b: 0 } }`, each channel keeps its own.
- A `__proto__` key from parsed JSON stays an own channel of `value`,
  `target`, and `velocity`, instead of setting the mirror's prototype.
- An array with holes throws with the hole's path.
