---
'coily': minor
---

`value` and `velocity` are now exact — reads are no longer rounded to the
configured precision. `precision` means what its documentation always
said: it sets the resting threshold (half a unit in the last place,
0.5 × 10⁻ᵖ) and nothing else. At rest, `value === target` exactly, since
rest zeroes the state; mid-flight values simply carry their full float
digits. `SpringConfig.precisionMultiplier` is removed along with the
rounding it served.

Resting detection now measures the decay envelope instead of boxing
position and velocity separately: a spring rests when
`|x| + |v|/ωₙ ≤ 0.5 × 10⁻ᵖ`, the same effective amplitude the
`timeRemaining` estimate uses (which now reports 0 exactly when resting).
The old check compared velocity — units per second — against a threshold
in value units, which misjudged rest in both directions: stiff springs
ticked extra tail frames after their motion stopped being resolvable, and
soft springs (ωₙ < 1) could be declared resting while still carrying
enough velocity to move visibly, cutting real motion short. Velocity now
counts as the future travel it can actually produce, so rest timing is
correct across the full stiffness range.
