/**
 * Type-level tests for the spring object Vue bridge: `useSpring` shape
 * overload dispatch and pool creation.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import { type Ref, ref } from 'vue'
import type { SpringConfig } from '../../src/index.ts'
import { type SpringRef, useSpring } from '../../src/vue/spring.ts'
import type { SpringObjectRef } from '../../src/vue/spring-object.ts'
import { useSpringPool } from '../../src/vue/pool.ts'

declare const cfg: SpringConfig

// ── Record shapes create object springs ─────────────────────────────

const obj = useSpring({ position: { x: 0, y: 0 }, opacity: 1 })
const typed: SpringObjectRef<{ position: { x: number; y: number }; opacity: number }> = obj
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

// ── Array shapes create object springs too — in every wrapping ──────

const tuple = useSpring([0, 0])
// Array literals infer as tuples — the arity is part of the shape
const tupleTyped: SpringObjectRef<[number, number]> = tuple
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
// into the Ref overload; runtime dispatch still links via the instance.
declare const chainTarget: Ref<{ x: number; y: number }> | SpringObjectRef<{ x: number; y: number }>
useSpring(chainTarget)

const follower = useSpring(obj)
const followerTyped: SpringObjectRef<{ position: { x: number; y: number }; opacity: number }> =
  follower
void followerTyped

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
const poolSpring = pool.createSpringObject({ x: 0 }, { tension: 170, damping: 26 })
const poolValue: number = poolSpring.value.x
void poolValue
// @ts-expect-error string channels are not animatable
pool.createSpringObject({ x: 'nope' })
