---
'coily': patch
---

A spring that follows a source from another `SpringSystem` now moves only
when its own system advances. It retargets from the source's updates, as
it would follow a custom `SpringSource`. Before, advancing the leader's
system could move the follower, and its own next frame jumped it back.
