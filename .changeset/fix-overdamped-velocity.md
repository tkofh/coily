---
"coily": patch
---

Fix incorrect velocity computation in the overdamped spring solver. The derivative of `sinh`/`cosh` was using the sign pattern from the underdamped `sin`/`cos` derivative, causing velocity to be significantly overestimated for heavily overdamped springs. This could delay or prevent rest detection and produce incorrect `spring.velocity` values.
