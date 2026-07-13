/**
 * Type-level tests for `mapSpring` source shapes and the `SpringSource`
 * contract surface.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import {
  mapSpring,
  velocityOf,
  accelerationOf,
  type Spring,
  type SpringDefinition,
  type SpringSystem,
  type CompositeSpring,
  type SpringSource,
  SpringSourceSymbol,
  type KinematicSource,
} from '../src/index.ts'

declare const a: Spring
declare const b: Spring
declare const custom: SpringSource
declare const cfg: SpringDefinition
declare const system: SpringSystem

// ── Single source ────────────────────────────────────────────────────

mapSpring(a, (value) => value * 2)
// @ts-expect-error a map derives values only; configure the follower instead
mapSpring(a, (value) => value * 2, cfg)

// ── Shapes of sources compose, and `map` receives their numbers ─────

mapSpring({ x: a, y: b }, (values) => {
  const x: number = values.x
  const y: number = values.y
  return Math.hypot(x, y)
})

mapSpring({ point: { x: a, y: b }, scale: custom }, ({ point, scale }) => point.x * scale)

mapSpring([a, b] as const, ([first, second]) => first + second)

declare const dynamic: Record<string, SpringSource>
mapSpring(dynamic, () => 0)

// Mapped sources are sources, so they nest as leaves
mapSpring({ doubled: mapSpring(a, (value) => value * 2), b }, ({ doubled, b }) => doubled + b)

// The result is a SpringSource and a valid target
declare const follower: Spring
follower.target = mapSpring({ x: a, y: b }, ({ x, y }) => Math.max(x, y))

// ── Composite springs are sources of their value shape ──────────────

declare const composite: CompositeSpring<{ x: number; y: number }>

// Bare: `map` receives the read-only value shape
mapSpring(composite, ({ x, y }) => Math.hypot(x, y))
mapSpring(composite, (point) => {
  const px: number = point.x
  return px
})

// As a leaf, alone or mixed with scalars
mapSpring({ pos: composite, t: a }, ({ pos, t }) => pos.x * t)

declare const p1: CompositeSpring<{ x: number; y: number }>
declare const p2: CompositeSpring<{ x: number; y: number }>
// `const T` infers bare array literals as tuples — no `as const` needed
mapSpring([p1, p2], ([from, to]) => (to.y - from.y) / (to.x - from.x))

// @ts-expect-error a composite is not a scalar source, so it cannot be followed
follower.target = composite

// ── The contract lives under the symbol slot ────────────────────────

// Springs and composites satisfy it with themselves as the api
a satisfies SpringSource
composite satisfies SpringSource<{ readonly x: number; readonly y: number }>

// A hand-rolled source is just the slot
const bridged: SpringSource = {
  [SpringSourceSymbol]: {
    value: 0,
    onUpdate: () => () => {},
    onDispose: () => () => {},
  },
}
follower.target = bridged

// ── velocityOf and accelerationOf derive sources from a source's motion

// A scalar spring yields a scalar derivative a spring can follow
velocityOf(a) satisfies SpringSource<number>
accelerationOf(a) satisfies SpringSource<number>
follower.target = velocityOf(a)
follower.target = accelerationOf(a)
mapSpring(velocityOf(a), (v) => 1 + Math.abs(v) * 0.001)
mapSpring(accelerationOf(a), (acc) => Math.min(1, Math.abs(acc) * 1e-4))

// A composite yields a derivative of the same shape: map it like the composite
velocityOf(composite) satisfies SpringSource<{ readonly x: number; readonly y: number }>
accelerationOf(composite) satisfies SpringSource<{ readonly x: number; readonly y: number }>
mapSpring(velocityOf(composite), ({ x, y }) => Math.hypot(x, y))
mapSpring(accelerationOf(composite), ({ x, y }) => Math.hypot(x, y))
// @ts-expect-error a velocity shape is not a scalar source, so it cannot be followed
follower.target = velocityOf(composite)

// A bridged source in motion carries both derivatives, and then it qualifies
const bridgedKinematic: KinematicSource = {
  [SpringSourceSymbol]: {
    value: 0,
    velocity: 0,
    acceleration: 0,
    onUpdate: () => () => {},
    onDispose: () => () => {},
  },
}
velocityOf(bridgedKinematic) satisfies SpringSource<number>
accelerationOf(bridgedKinematic) satisfies SpringSource<number>

// @ts-expect-error a plain source is not in motion
velocityOf(bridged)
// @ts-expect-error a mapped source is a value derivation, so it is not in motion
velocityOf(mapSpring(a, (value) => value * 2))
// @ts-expect-error the derived velocity source has no motion of its own
accelerationOf(velocityOf(a))

// Followers read through the slot, and its value is read-only
const api = custom[SpringSourceSymbol]
const current: number = api.value
void current
// @ts-expect-error the api's value is read-only
api.value = 5

// The source's public face carries nothing
// @ts-expect-error reads go through the SpringSourceSymbol slot
void custom.value
// @ts-expect-error subscriptions go through the SpringSourceSymbol slot
void custom.onUpdate

// ── The contract carries values only — no config surface ────────────

// @ts-expect-error sources offer no config
void custom.config
// @ts-expect-error sources fire no configure events
void custom.onConfigure

// ── createSpring accepts a source: follow at creation ───────────────

system.createSpring(a) satisfies Spring
system.createSpring(a, cfg)
system.createSpring(mapSpring(a, (value) => value * 2))
system.createSpring(mapSpring(composite, ({ x, y }) => Math.hypot(x, y)))
// @ts-expect-error a composite cannot be followed at creation; map it first
system.createSpring(composite, cfg)

// ── Invalid leaves are rejected where they are declared ─────────────

// @ts-expect-error number leaves are not sources
mapSpring({ x: a, y: 5 }, () => 0)
// @ts-expect-error nested leaves are validated too
mapSpring({ point: { x: a, y: 'nope' } }, () => 0)
declare const optional: { x: Spring; y?: Spring }
// @ts-expect-error optional leaves are rejected
mapSpring(optional, () => 0)
// @ts-expect-error a shape must contain at least one source
mapSpring({}, () => 0)
