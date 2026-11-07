/**
 * Type-level tests for the composite spring Vue bridge: `useSpring` shape
 * overload dispatch and pool creation.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import { type Ref, computed, ref } from 'vue'
import {
  type CompositeSpring,
  type SpringDefinition,
  type SpringSource,
  type TargetedSource,
  accelerationOf,
  targetOf,
  velocityOf,
} from '../../src/index.ts'
import { type SpringRef, useSpring } from '../../src/vue/spring.ts'
import type { CompositeSpringRef } from '../../src/vue/composite-spring.ts'
import { useSpringPool } from '../../src/vue/pool.ts'

declare const cfg: SpringDefinition

// ── Record shapes create object springs ─────────────────────────────

const obj = useSpring({ position: { x: 0, y: 0 }, opacity: 1 })
const typed: CompositeSpringRef<{ position: { x: number; y: number }; opacity: number }> = obj
void typed

const px: number = obj.value.position.x
const vy: number = obj.velocity.value.position.y
void px
void vy

obj.value = { opacity: 0 } // partial write through the ref
obj.jumpTo({ position: { x: 10 } })

// @ts-expect-error composite reads are deeply read-only
obj.value.position.x = 5
// @ts-expect-error unknown channels are rejected
obj.value = { z: 1 }

useSpring(ref({ x: 0, y: 0 }))
useSpring(() => ({ x: 0, y: 0 }))

// ── Refs derive sources like the springs they wrap ──────────────────

declare const scalarRef: SpringRef
scalarRef satisfies TargetedSource
velocityOf(scalarRef) satisfies SpringSource<number>
accelerationOf(scalarRef) satisfies SpringSource<number>
targetOf(scalarRef) satisfies SpringSource<number>
useSpring(targetOf(scalarRef))

obj satisfies TargetedSource<{
  readonly position: { readonly x: number; readonly y: number }
  readonly opacity: number
}>
targetOf(obj) satisfies SpringSource<{
  readonly position: { readonly x: number; readonly y: number }
  readonly opacity: number
}>

// ── Array shapes create object springs too, in every wrapping ───────

const tuple = useSpring([0, 0])
// Array literals infer as tuples, so the arity is part of the shape
const tupleTyped: CompositeSpringRef<[number, number]> = tuple
void tupleTyped
useSpring(ref([0, 0]))
useSpring(() => [0, 0])
declare const pair: [number, number]
const fixed = useSpring(pair)
fixed.value = [undefined, 100]
// @ts-expect-error more channels than the shape has
fixed.value = [1, 2, 3]

// ── Options accept anything ConfigShape does, reactively ────────────

useSpring({ x: 0, y: 0 }, cfg)
// @ts-expect-error bare options are not a config, so wrap them in defineSpring
useSpring({ x: 0, y: 0 }, { tension: 170, damping: 26 })
useSpring({ x: 0, y: 0 }, { x: cfg })
useSpring({ x: 0, y: 0 }, ref({ x: cfg }))
useSpring({ x: 0, y: 0 }, () => null)
// @ts-expect-error unknown channel in the config shape
useSpring({ x: 0, y: 0 }, { z: cfg })

// ── Scalar overloads are untouched ──────────────────────────────────

const scalar: SpringRef = useSpring(0)
const scalarValue: number = scalar.value
void scalarValue
useSpring(ref(5))
useSpring(() => 10)

// ── Linked object refs ──────────────────────────────────────────────

// Chain-building unions (ref-or-leader, as in a follower loop) collapse
// into the shape overload's ref member; runtime dispatch still links via
// the instance.
declare const chainTarget:
  | Ref<{ x: number; y: number }>
  | CompositeSpringRef<{ x: number; y: number }>
useSpring(chainTarget)

const follower = useSpring(obj)
const followerTyped: CompositeSpringRef<{ position: { x: number; y: number }; opacity: number }> =
  follower
void followerTyped

// Getters, computeds, and pooled composites lead too, and a getter can
// switch leaders.
declare const pick: Ref<boolean>
declare const left: CompositeSpringRef<{ x: number; y: number }>
declare const right: CompositeSpringRef<{ x: number; y: number }>
declare const pooled: CompositeSpring<{ x: number; y: number }>
type Point = CompositeSpringRef<{ x: number; y: number }>
useSpring(() => (pick.value ? left : right)) satisfies Point
useSpring(() => (pick.value ? left : pooled)) satisfies Point
useSpring(computed(() => (pick.value ? left : right))) satisfies Point
useSpring(pooled) satisfies Point
useSpring(() => (pick.value ? left : { x: 0, y: 0 })) satisfies Point
// @ts-expect-error every leader must have the follower's shape
useSpring(() => (pick.value ? left : { x: 0 }))
useSpring(pooled, { x: cfg }) satisfies Point

// @ts-expect-error a shape-valued source that is not a composite cannot be followed
useSpring(velocityOf(obj))

// ── Invalid shapes are rejected ─────────────────────────────────────

// @ts-expect-error string channels are not animatable
useSpring({ x: 'nope' })
// @ts-expect-error boolean channels are not animatable
useSpring({ visible: true })
// @ts-expect-error a shape needs at least one channel
useSpring({})
// @ts-expect-error getter elements are not numeric channels
useSpring([0, () => 10])

// ── Pool creation ───────────────────────────────────────────────────

const pool = useSpringPool()
const poolSpring = pool.createSpring({ x: 0 }, cfg)
const poolValue: number = poolSpring.value.x
void poolValue
// @ts-expect-error string channels are not animatable
pool.createSpring({ x: 'nope' })
