---
'coily': patch
---

Fix three frame loop bugs.

- Calling `stop()` and then `start()` in a listener during a frame
  scheduled a second frame loop, so every listener ran twice per frame
  until the next `stop()`. The system now keeps a single loop.
- `CompositeSpring.settled` could hang when read during a tick, for example
  in another spring's update listener. If the composite came back to rest
  before that tick ended, it fired neither `start` nor `stop`, and the
  promise waited for later motion. It now resolves at the end of the tick.
- `lagThreshold` and `adjustedLag` read back the values you set. Setting
  `lagThreshold` to 0 read back as `100000000`, and a gap longer than that
  still counted as lag. Setting `lagThreshold` below `adjustedLag` also
  lowered `adjustedLag` for good, so setting `lagThreshold` to 10 and then
  500 left `adjustedLag` at 10. Now 0 disables lag clamping for every gap,
  and a frame that clamps uses at most `lagThreshold` of `adjustedLag`
  without changing the setting.
