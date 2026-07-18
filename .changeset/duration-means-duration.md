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
relaxed as a result. To keep a spring's previous feel, multiply its
`duration` by 0.7.
