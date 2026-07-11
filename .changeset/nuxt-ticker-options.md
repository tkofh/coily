---
'coily': minor
---

The Nuxt module now forwards `fps`, `lagThreshold`, and `adjustedLag` to
the shared spring system, so the app-wide ticker can be configured from
module options. With the new uncapped default nothing needs configuring —
the plumbing exists for apps that want an explicit ceiling or different
lag handling.
