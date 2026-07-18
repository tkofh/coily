---
'coily': minor
---

Follower chains now advance in dependency order. Every frame, each
spring moves after the springs it follows — regardless of creation
order, wiring order, or springs resting and waking mid-chain — so a
follower always chases its leader's current value instead of last
frame's. Deep chains that turned bumpy when frames slowed are steady
now: that wobble came from followers reading one-frame-stale leaders
after rest/wake churn silently reordered the update loop. Springs that
follow nothing are unaffected. The guarantee covers wrapper sources
too: following an object that hands out another source's api — a Vue
`SpringRef`, or your own wrapper honoring the `SpringSource` contract —
orders the follower after the spring behind it.

Update events are delivered once per spring per frame, after the whole
frame has advanced, in that same leader-first order. Two visible
consequences: a callback that reads other springs sees their final
values for the frame, never a half-advanced mix, and a spring
retargeted from inside an update callback applies the write immediately
but takes its first step on the next frame — the callback runs at frame
end, with no frame time left to consume. Synchronous writes (`target`,
`value`, `jumpTo`) still notify immediately, exactly as before.

Cycles advance members in creation order, with the edge that closes the
loop chasing one frame behind — now a guarantee rather than an accident
of construction order.
