/**
 * Type-level tests for `mapSpring` source shapes and the config
 * parameter's overload split.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import {
  mapSpring,
  type Spring,
  type SpringDefinition,
  type SpringSystem,
  type CompositeSpring,
  type SpringSource,
} from '../src/index.ts'

declare const a: Spring
declare const b: Spring
declare const custom: SpringSource
declare const cfg: SpringDefinition
declare const system: SpringSystem

// ── Single source: config is optional ────────────────────────────────

mapSpring(a, (value) => value * 2)
mapSpring(a, (value) => value * 2, cfg)
mapSpring(a, (value) => value * 2, null)

// ── Shapes of sources compose, and `map` receives their numbers ─────

mapSpring(
  { x: a, y: b },
  (values) => {
    const x: number = values.x
    const y: number = values.y
    return Math.hypot(x, y)
  },
  null,
)

mapSpring({ point: { x: a, y: b }, scale: custom }, ({ point, scale }) => point.x * scale, cfg)

mapSpring([a, b] as const, ([first, second]) => first + second, null)

declare const dynamic: Record<string, SpringSource>
mapSpring(dynamic, () => 0, null)

// Mapped sources are sources, so they nest as leaves
mapSpring({ doubled: mapSpring(a, (value) => value * 2), b }, ({ doubled, b }) => doubled + b, null)

// The result is a SpringSource and a valid target
declare const follower: Spring
follower.target = mapSpring({ x: a, y: b }, ({ x, y }) => Math.max(x, y), null)

// ── Composite springs are sources of their value shape ──────────────

declare const composite: CompositeSpring<{ x: number; y: number }>

// Bare: `map` receives the read-only value shape
mapSpring(composite, ({ x, y }) => Math.hypot(x, y), null)
mapSpring(
  composite,
  (point) => {
    const px: number = point.x
    return px
  },
  cfg,
)

// As a leaf, alone or mixed with scalars
mapSpring({ pos: composite, t: a }, ({ pos, t }) => pos.x * t, null)

declare const p1: CompositeSpring<{ x: number; y: number }>
declare const p2: CompositeSpring<{ x: number; y: number }>
mapSpring([p1, p2] as const, ([from, to]) => (to.y - from.y) / (to.x - from.x), null)

// @ts-expect-error a composite map must state the config it offers
mapSpring(composite, ({ x, y }) => x + y)
// @ts-expect-error a composite is not a scalar source, so it cannot be followed
follower.target = composite

// ── createSpring accepts a source: follow at creation ───────────────

system.createSpring(a) satisfies Spring
system.createSpring(a, cfg)
system.createSpring(mapSpring(a, (value) => value * 2))
system.createSpring(mapSpring(composite, ({ x, y }) => Math.hypot(x, y), null))
// @ts-expect-error a composite cannot be followed at creation; map it first
system.createSpring(composite, cfg)

// ── Shape maps must state the config they offer ─────────────────────

// @ts-expect-error several sources have no shared config to pass through
mapSpring({ x: a, y: b }, ({ x, y }) => x + y)

// ── Invalid leaves are rejected where they are declared ─────────────

// @ts-expect-error number leaves are not sources
mapSpring({ x: a, y: 5 }, () => 0, null)
// @ts-expect-error nested leaves are validated too
mapSpring({ point: { x: a, y: 'nope' } }, () => 0, null)
declare const optional: { x: Spring; y?: Spring }
// @ts-expect-error optional leaves are rejected
mapSpring(optional, () => 0, null)
// @ts-expect-error a shape must contain at least one source
mapSpring({}, () => 0, null)
