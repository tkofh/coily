/**
 * Type-level tests for spring object value shapes, partial shapes, and
 * config shapes.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import type {
  ReadonlyShape,
  Spring,
  SpringDefinition,
  SpringObject,
  SpringSystem,
} from '../src/index.ts'

declare const system: SpringSystem
declare const cfg: SpringDefinition

// ── Value shapes: everything numeric composes ───────────────────────

system.createSpring({ x: 0, y: 0 })
system.createSpring({ position: { x: 0, y: 0 }, color: [0, 0, 0], opacity: 1 })
system.createSpring([0, 0])
system.createSpring({ 0: 10, 1: 20 })
system.createSpring({ items: [{ x: 0 }, { x: 1 }] })

// Interfaces satisfy `Shape` without index signatures
interface Vector2 {
  x: number
  y: number
}
declare const vec: Vector2
system.createSpring(vec)

interface Transform {
  position: Vector2
  scale: number
}
declare const transform: Transform
system.createSpring(transform)

// Dynamic records and tuples
declare const channels: Record<string, number>
system.createSpring(channels)
declare const pair: [number, number]
const tuple = system.createSpring(pair)

// ── Value shapes: non-numeric leaves are rejected at the leaf ───────

// @ts-expect-error string channels are not animatable
system.createSpring({ x: 'nope' })
// @ts-expect-error boolean channels are not animatable
system.createSpring({ visible: true })
// @ts-expect-error null is not a channel value
system.createSpring({ x: null })
// @ts-expect-error nested channels are validated too
system.createSpring({ position: { x: 0, y: 'nope' } })
// @ts-expect-error functions are not channels
system.createSpring({ f: () => 0 })
// @ts-expect-error class instances are not plain shapes
system.createSpring(new Date())
// @ts-expect-error strings are neither scalar values nor shapes
system.createSpring('5')
// @ts-expect-error a shape needs at least one channel
system.createSpring({})
// @ts-expect-error empty subtrees have no channels
system.createSpring({ position: {} })
// @ts-expect-error empty arrays have no channels
system.createSpring({ items: [] })

// Channels that may be absent or undefined would make two springs of the
// same declared shape structurally incompatible at runtime, so `Shape`
// rejects them outright.
declare const optional: { x: number; y?: number }
// @ts-expect-error optional channels are rejected
system.createSpring(optional)
// @ts-expect-error undefined is not a channel value
system.createSpring({ x: 0, y: undefined })
declare const mixed: { x: number | string }
// @ts-expect-error union channels must be plain numbers
system.createSpring(mixed)

// ── Inference, partial writes, and read-only reads ──────────────────

const obj = system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 })

const opacity: number = obj.value.opacity
const x: number = obj.target.position.x
void opacity
void x

obj.target = { position: { x: 100 } }
obj.target = { position: { x: 100, y: 50 }, opacity: 0 }
obj.value = { opacity: 0.5 }
obj.velocity = { position: { y: 10 } }
obj.jumpTo({ position: { x: 0 } })

// @ts-expect-error unknown channels are rejected
obj.target = { position: { z: 1 } }
// @ts-expect-error channel targets are numbers
obj.target = { opacity: '1' }
// @ts-expect-error composite reads are live mirrors — deeply read-only
obj.value.position.x = 5

tuple.target = [100, 100]
tuple.target = [undefined, 100]
// @ts-expect-error more channels than the shape has
tuple.target = [1, 2, 3]
tuple.config = [null, cfg]

declare const deepReadonly: ReadonlyShape<{ color: [number, number] }>
// @ts-expect-error readonly applies through arrays as well
deepReadonly.color[0] = 5

// ── Following: shapes must match exactly (SpringObject is invariant) ─

declare const leader: SpringObject<Vector2>
declare const follower: SpringObject<Vector2>

follower.target = leader

// Structurally identical shapes are the same shape
declare const twin: SpringObject<{ x: number; y: number }>
follower.target = twin

// @ts-expect-error a leader is passed bare, not wrapped in an object
follower.target = { spring: leader }

declare const leader3d: SpringObject<{ x: number; y: number; z: number }>
// @ts-expect-error a wider shape cannot lead this spring
follower.target = leader3d
declare const follower3d: SpringObject<{ x: number; y: number; z: number }>
// @ts-expect-error a narrower shape cannot lead this spring
follower3d.target = leader

// ── Config shapes ────────────────────────────────────────────────────

system.createSpring({ x: 0, y: 0 }, cfg)
system.createSpring({ x: 0, y: 0 }, null)
system.createSpring({ x: 0, y: 0 }, { x: cfg })
system.createSpring({ x: 0, y: 0 }, { x: cfg, y: null })
system.createSpring({ position: { x: 0, y: 0 }, opacity: 1 }, { position: cfg })

obj.config = cfg
obj.config = null
obj.config = { position: { x: cfg } }

// @ts-expect-error unknown channels in config shapes are rejected
obj.config = { z: cfg }
// @ts-expect-error a number is not a config
obj.config = { opacity: 170 }

// Configs are always `SpringDefinition` instances, so a bare options object is
// rejected everywhere a config is expected.
// @ts-expect-error bare options are not a config
system.createSpring({ x: 0, y: 0 }, { tension: 170, damping: 26 })
// @ts-expect-error bare options are not a config, even at a leaf
system.createSpring({ x: 0, y: 0 }, { x: { tension: 170, damping: 26 } })

// A channel named like a spring option is unremarkable — there is no
// ambiguity to resolve, since a config is always a `SpringDefinition`.
const collide = system.createSpring({ tension: 0, damping: 0 })
collide.config = cfg
collide.config = { tension: cfg, damping: cfg }
// @ts-expect-error a number is not a config, even at an option-named channel
collide.config = { tension: 170, damping: 26 }

// ── One `createSpring`, dispatched on the value ─────────────────────

// Scalar creation takes a number; any object or array is a value shape.
// Channels named `target` or `value` are unremarkable — the displaced
// scalar creation form that once claimed such literals no longer exists.
const scalar: Spring = system.createSpring(5)
const composite: SpringObject<{ target: number; value: number }> = system.createSpring({
  target: 100,
  value: 0,
})
void scalar
void composite
