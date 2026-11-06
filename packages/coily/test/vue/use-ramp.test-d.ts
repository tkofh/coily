/**
 * Type-level tests for `useRamp`: its inputs, and the `RampRef` it returns
 * as a source.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). Each `@ts-expect-error`
 * is self-validating: tsc fails if the line stops erroring.
 */
import { type Ref, ref } from 'vue'
import { type TargetedSource, mapSpring, targetOf, velocityOf } from '../../src/index.ts'
import { type RampRef, useRamp } from '../../src/vue/ramp.ts'
import { type SpringRef, useSpring } from '../../src/vue/spring.ts'

// The doc example: an endless ramp followed by a spring.
const angle = useRamp(Infinity, 270, { from: 0 })
const ring: SpringRef = useSpring(angle, { duration: 300, dampingRatio: 1 })
void ring

// Targets and rates take numbers, refs, and getters.
const heading = ref(0)
const slew: RampRef = useRamp(heading, 400)
useRamp(() => heading.value * 2, ref(10), { purpose: 'nonmotion' })

// A RampRef is a writable number ref and a targeted source.
const value: Ref<number> = slew
const source: TargetedSource = slew
void value
void source
velocityOf(slew)
targetOf(slew)
mapSpring(slew, (v) => v * 2)
const resting: boolean = slew.isResting.value
const remaining: number = slew.timeRemaining.value
void resting
void remaining

// @ts-expect-error 'appearance' is not a Purpose
useRamp(0, 10, { purpose: 'appearance' })
