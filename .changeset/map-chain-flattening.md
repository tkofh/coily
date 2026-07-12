---
'coily': patch
---

`mapSpring` chains compose flat: mapping a mapped source extends its
pipeline instead of wrapping it, so reads run one loop over the
composed functions and subscriptions attach to the chain's roots.
Nested getters previously overflowed the call stack near 600 maps
deep; chains of any length now read iteratively. Behavior is otherwise
identical.
