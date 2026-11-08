---
'coily': patch
---

The Nuxt module disposes its spring system when the app unmounts, so the
frame loop and the visibility and reduced-motion listeners end with the
app, including on a development reload.
