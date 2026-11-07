---
'coily': minor
---

Add `SpringSystem.dispose()`. Each system adds a page visibility listener
and, with `reducedMotion: 'user'`, a media query listener, and before this
change nothing removed them. `dispose()` stops the system for good and
removes both. After dispose, `start()` throws and `advance` still works.

`useSpringSystem` now disposes the system it creates when its component
unmounts, so a component that mounts many times, such as a route page, no
longer keeps every system it created alive.
