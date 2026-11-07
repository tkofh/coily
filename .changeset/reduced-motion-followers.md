---
'coily': patch
---

Fix followers under reduced motion.

- A follower now snaps once when reduced motion turns on. A spring that
  followed a moving spring got two `update` events, and a follower that
  started moving before its leader snapped first to a stale target. Each
  spring now snaps to its final target, with one `update` and one `stop`.
- A `'motion'` spring that follows a moving `'nonmotion'` spring snaps to
  it every frame, and its update listener ran in the middle of the frame, while
  other springs still held the previous frame's values. It now runs with
  the frame's other events, so every spring it reads is at its final value
  for the frame.
