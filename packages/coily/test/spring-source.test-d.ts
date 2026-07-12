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
  type SpringObject,
  type SpringSource,
} from '../src/index.ts'

declare const a: Spring
declare const b: Spring
declare const custom: SpringSource
declare const cfg: SpringDefinition

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

// ── Shape maps must state the config they offer ─────────────────────

// @ts-expect-error several sources have no shared config to pass through
mapSpring({ x: a, y: b }, ({ x, y }) => x + y)

// ── Invalid leaves are rejected where they are declared ─────────────

// @ts-expect-error number leaves are not sources
mapSpring({ x: a, y: 5 }, () => 0, null)
// @ts-expect-error nested leaves are validated too
mapSpring({ point: { x: a, y: 'nope' } }, () => 0, null)
declare const composite: SpringObject<{ x: number; y: number }>
// @ts-expect-error a SpringObject is not a source — its channels are not public
mapSpring({ pos: composite }, () => 0, null)
declare const optional: { x: Spring; y?: Spring }
// @ts-expect-error optional leaves are rejected
mapSpring(optional, () => 0, null)
// @ts-expect-error a shape must contain at least one source
mapSpring({}, () => 0, null)
