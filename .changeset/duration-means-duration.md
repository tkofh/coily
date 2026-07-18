---
'coily': minor
---

Duration-based configs now rest at the requested `duration` instead of
comfortably inside it. The same 2x margin that inflated `timeRemaining`
was baked into the duration tuning, so a `duration: 750` config
actually rested around 500ms — and the default config, advertised as
settling in about 500ms, rested around 350ms. Motion now uses the full
advertised window: rest lands within a frame of `duration`
(non-oscillating configs), or up to one oscillation earlier (bouncy
configs).

Every duration-tuned spring, the default included, is noticeably more
relaxed as a result. To keep a spring's previous feel, scale its
`duration` down: the factor depends on the damping ratio and
displacement — about 0.7 for the default config, down to roughly 0.5
for configs far from critical damping (a `bounce: -1` chain wants
~0.53). Springs that follow each other are the most visible case:
softer links lag each other further, so retune chained configs first.
