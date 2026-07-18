/**
 * Type-level tests for the `defineSpring` input shapes.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import { defineSpring } from '../src/index.ts'

// ── Every documented input shape compiles ───────────────────────────

defineSpring({ tension: 170, damping: 26 })
defineSpring({ mass: 2, tension: 170, damping: 26, precision: 3 })
defineSpring({ tension: 170, dampingRatio: 0.8 })
defineSpring({ mass: 2, tension: 170, bounce: 0.2 })
defineSpring({ damping: 26, dampingRatio: 1 })
defineSpring({ mass: 2, damping: 26, bounce: -0.5 })
defineSpring({ tension: 170, damping: 26, dampingRatio: 1 })
defineSpring({ tension: 170, damping: 26, bounce: 0 })
defineSpring({ dampingRatio: 1, duration: 500 })
defineSpring({ mass: 2, dampingRatio: 1, duration: 500, displacement: 100 })
defineSpring({ bounce: 0.3, duration: 500 })
defineSpring({ tension: 170, dampingRatio: 1, duration: 500 })
defineSpring({ tension: 170, bounce: 0.1, duration: 500 })
defineSpring({ damping: 26, dampingRatio: 1, duration: 500 })
defineSpring({ damping: 26, bounce: 0.1, duration: 500 })

// Explicit undefined is equivalent to absence (exactOptionalPropertyTypes)
defineSpring({ mass: undefined, tension: 170, damping: 26 })

// ── `arrival` joins every shape family ───────────────────────────────

defineSpring({ tension: 170, damping: 26, arrival: 'stop' })
defineSpring({ tension: 170, dampingRatio: 0.8, arrival: 'passthrough' })
defineSpring({ mass: 2, tension: 170, bounce: 0.2, arrival: -0.75 })
defineSpring({ dampingRatio: 1, duration: 500, arrival: 0.5 })
defineSpring({ tension: 170, damping: 26, arrival: undefined })

// @ts-expect-error arrival names are only 'passthrough' and 'stop'
defineSpring({ tension: 170, damping: 26, arrival: 'rebound' })

// ── Shapes where mass is derived reject it ──────────────────────────

// @ts-expect-error mass is derived from tension, damping, and dampingRatio
defineSpring({ mass: 2, tension: 170, damping: 26, dampingRatio: 1 })
// @ts-expect-error mass is derived from tension, damping, and bounce
defineSpring({ mass: 2, tension: 170, damping: 26, bounce: 0.2 })
// @ts-expect-error mass is derived in duration-based configs with tension
defineSpring({ mass: 2, tension: 170, dampingRatio: 1, duration: 500 })
// @ts-expect-error mass is derived in duration-based configs with tension
defineSpring({ mass: 2, tension: 170, bounce: 0.1, duration: 500 })
// @ts-expect-error mass is derived in duration-based configs with damping
defineSpring({ mass: 2, damping: 26, dampingRatio: 1, duration: 500 })
// @ts-expect-error mass is derived in duration-based configs with damping
defineSpring({ mass: 2, damping: 26, bounce: 0.2, duration: 500 })

// ── Mixed and incomplete shapes are rejected ────────────────────────

// @ts-expect-error dampingRatio and bounce are mutually exclusive
defineSpring({ tension: 170, dampingRatio: 1, bounce: 0.2 })
// @ts-expect-error duration requires dampingRatio or bounce
defineSpring({ duration: 500 })
// @ts-expect-error displacement only applies to duration-based configs
defineSpring({ tension: 170, damping: 26, displacement: 5 })
// @ts-expect-error tension alone is not a complete config
defineSpring({ tension: 170 })
// @ts-expect-error empty input is not a valid config
defineSpring({})
