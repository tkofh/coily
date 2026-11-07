---
'coily': patch
---

Fix followers under reduced motion that notified listeners too early.
A `'motion'` spring that follows a moving `'nonmotion'` spring snaps to
it every frame. Its update listener ran in the middle of the frame,
while other springs still held the previous frame's values. It now runs
with the frame's other events, so it reads every spring at its final
value for the frame.
