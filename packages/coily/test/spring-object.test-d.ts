/**
 * Type-level tests for spring object value shapes, partial shapes, and
 * config shapes.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import type { SpringOptionKeys } from '../src/config.ts'
import type {
  ReadonlyShape,
  Shape,
  SpringConfig,
  SpringObject,
  SpringOptions,
  SpringPosition,
  SpringSystem,
} from '../src/index.ts'

declare const system: SpringSystem
declare const cfg: SpringConfig

// ── Value shapes: everything numeric composes ───────────────────────

system.createSpringObject({ x: 0, y: 0 })
system.createSpringObject({ position: { x: 0, y: 0 }, color: [0, 0, 0], opacity: 1 })
system.createSpringObject([0, 0])
system.createSpringObject({ 0: 10, 1: 20 })
system.createSpringObject({ items: [{ x: 0 }, { x: 1 }] })

// Interfaces satisfy `Shape` without index signatures
interface Vector2 {
  x: number
  y: number
}
declare const vec: Vector2
system.createSpringObject(vec)

interface Transform {
  position: Vector2
  scale: number
}
declare const transform: Transform
system.createSpringObject(transform)

// Dynamic records and tuples
declare const channels: Record<string, number>
system.createSpringObject(channels)
declare const pair: [number, number]
const tuple = system.createSpringObject(pair)

// ── Value shapes: non-numeric leaves are rejected at the leaf ───────

// @ts-expect-error string channels are not animatable
system.createSpringObject({ x: 'nope' })
// @ts-expect-error boolean channels are not animatable
system.createSpringObject({ visible: true })
// @ts-expect-error null is not a channel value
system.createSpringObject({ x: null })
// @ts-expect-error nested channels are validated too
system.createSpringObject({ position: { x: 0, y: 'nope' } })
// @ts-expect-error functions are not channels
system.createSpringObject({ f: () => 0 })
// @ts-expect-error class instances are not plain shapes
system.createSpringObject(new Date())
// @ts-expect-error primitives are not shapes
system.createSpringObject(5)
// @ts-expect-error a shape needs at least one channel
system.createSpringObject({})
// @ts-expect-error empty subtrees have no channels
system.createSpringObject({ position: {} })
// @ts-expect-error empty arrays have no channels
system.createSpringObject({ items: [] })

// Channels that may be absent or undefined would make two springs of the
// same declared shape structurally incompatible at runtime, so `Shape`
// rejects them outright.
declare const optional: { x: number; y?: number }
// @ts-expect-error optional channels are rejected
system.createSpringObject(optional)
// @ts-expect-error undefined is not a channel value
system.createSpringObject({ x: 0, y: undefined })
declare const mixed: { x: number | string }
// @ts-expect-error union channels must be plain numbers
system.createSpringObject(mixed)

// ── Inference, partial writes, and read-only reads ──────────────────

const obj = system.createSpringObject({ position: { x: 0, y: 0 }, opacity: 1 })

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
follower.target = { spring: leader }
follower.target = { spring: leader, offset: { x: 10 } }
follower.target = { spring: leader, offset: { x: 10, y: -4 } }

// Structurally identical shapes are the same shape
declare const twin: SpringObject<{ x: number; y: number }>
follower.target = twin

// @ts-expect-error offsets are partials of the value shape
follower.target = { spring: leader, offset: { z: 1 } }

declare const leader3d: SpringObject<{ x: number; y: number; z: number }>
// @ts-expect-error a wider shape cannot lead this spring
follower.target = leader3d
declare const follower3d: SpringObject<{ x: number; y: number; z: number }>
// @ts-expect-error a narrower shape cannot lead this spring
follower3d.target = leader

// ── Config shapes ────────────────────────────────────────────────────

system.createSpringObject({ x: 0, y: 0 }, cfg)
system.createSpringObject({ x: 0, y: 0 }, { tension: 170, damping: 26 })
system.createSpringObject({ x: 0, y: 0 }, null)
system.createSpringObject({ x: 0, y: 0 }, { x: cfg })
system.createSpringObject({ x: 0, y: 0 }, { x: { tension: 170, damping: 26 }, y: null })
system.createSpringObject({ position: { x: 0, y: 0 }, opacity: 1 }, { position: cfg })

obj.config = cfg
obj.config = null
obj.config = { position: { x: cfg } }

// @ts-expect-error unknown channels in config shapes are rejected
obj.config = { z: cfg }
// @ts-expect-error a number is not a config
obj.config = { opacity: 170 }

// Value shapes own their key namespace: where channels share spring option
// names, a bare options object is ambiguous, so `ConfigShape` only accepts
// a `SpringConfig` or a per-channel shape there. (This is stricter than the
// runtime, which accepts an options object whenever at least one of its
// keys falls outside the shape — the type cannot express "at least one",
// so it asks for the unambiguous spelling.)
const collide = system.createSpringObject({ tension: 0, damping: 0 })
collide.config = cfg
collide.config = { tension: cfg, damping: cfg }
// @ts-expect-error ambiguous: channels are named like spring options
collide.config = { tension: 170, damping: 26 }
const partialCollide = system.createSpringObject({ tension: 0, other: 0 })
// @ts-expect-error rejected even though the runtime would read it as options
partialCollide.config = { tension: 170, damping: 26 }

// ── Why shapes get `createSpringObject`, not a `createSpring` overload ─

// A shape whose root keys are a subset of {target, value} already has a
// meaning as a scalar spring descriptor. The same literal satisfying both
// types is the proof: an overloaded `createSpring` would silently pick the
// scalar parse and return the wrong instance type for such shapes.
const ambiguous = { target: 100, value: 0 }
const asScalarDescriptor: SpringPosition = ambiguous
const asValueShape: Shape<{ target: number; value: number }> = ambiguous
void asScalarDescriptor
void asValueShape

// The two creation paths stay disjoint:
// @ts-expect-error a value shape is not a scalar spring position
system.createSpring({ x: 0, y: 0 })

// ── SpringOptions and the runtime option-key set stay in lockstep ───

type KeysOfUnion<U> = U extends unknown ? keyof U : never
const optionKeysCovered: [KeysOfUnion<SpringOptions>] extends [SpringOptionKeys]
  ? [SpringOptionKeys] extends [KeysOfUnion<SpringOptions>]
    ? true
    : never
  : never = true
void optionKeysCovered
