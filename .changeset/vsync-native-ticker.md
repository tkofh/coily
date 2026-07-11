---
'coily': minor
---

`fps` no longer defaults to 60 — springs now advance once per displayed
frame, at whatever rate the display actually refreshes. On a 120Hz panel
the old default stepped (and painted) on every other frame, and because the
60fps accumulator grid aliased against the frame grid, timestamp jitter
interleaved 16.7ms and 25ms steps. Trajectories are unchanged (the solvers
are closed-form, so tick frequency only picks sample points), so no spring
configs need retuning. Pass `fps: 60` explicitly to restore the old pacing.

`fps` is now an opt-in ceiling, with `0` (the new default) meaning
uncapped — the same convention as `lagThreshold`'s `0` to disable lag
detection. A cap is frame-paced: ticks land on whole display frames with
half-a-frame tolerance, so a cap can never alias against vsync, and each
capped tick's `delta` is still the true elapsed time across the frames it
spans. Assigning `0` at runtime removes a cap. `tick()` and `deltaRatio`
keep their meaning through the reference gap — `1000 / fps` when capped,
1000/60 otherwise.

The loop also costs nothing while idle: when every motion rests, no further
animation frame is scheduled, and the next retarget, value, or velocity
write wakes it. Waking (and starting) re-anchors the clock on the first
frame callback instead of `performance.now()`, so idle time never becomes a
physics step and the first delta can no longer be negative. The
non-browser `setTimeout` fallback now forwards a timestamp to the frame
callback (it previously passed none, producing `NaN` deltas).
