import { type MaybeRefOrGetter, toValue, watchSyncEffect } from 'vue'
import type { Spring2D } from '../spring2d.ts'
import type { Vector2 } from '../vector2.ts'
import {
  type ReactiveSpringRef,
  type UseSpringOptions,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
} from './reactive-spring.ts'

// ── SpringRef2D ─────────────────────────────────────────────────────

export interface SpringRef2D extends ReactiveSpringRef<Readonly<Vector2>, Vector2> {}

/** @internal Symbol to access the underlying Spring2D from a SpringRef2D */
const Spring2DInstanceKey = Symbol('spring2d')

type Spring2DRefWithInstance = SpringRef2D & { [Spring2DInstanceKey]: Spring2D }

function hasSpring2DInstance(value: unknown): value is Spring2DRefWithInstance {
  return typeof value === 'object' && value !== null && Spring2DInstanceKey in value
}

// ── useSpring2D ─────────────────────────────────────────────────────

export function useSpring2D(
  target: MaybeRefOrGetter<Vector2>,
  options?: UseSpringOptions,
): SpringRef2D
export function useSpring2D(target: SpringRef2D, options?: UseSpringOptions): SpringRef2D
export function useSpring2D(
  target: MaybeRefOrGetter<Vector2> | SpringRef2D,
  options?: UseSpringOptions,
): SpringRef2D {
  if (hasSpring2DInstance(target)) {
    return createLinkedSpringRef2D(target, options)
  }
  return createSpringRef2D(target as MaybeRefOrGetter<Vector2>, options)
}

function createSpringRef2D(
  target: MaybeRefOrGetter<Vector2>,
  options: UseSpringOptions | undefined,
): SpringRef2D {
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  const spring = system.createSpring2D(toValue(target), config.value)
  const ref = createReactiveSpringRef(spring, config, Spring2DInstanceKey)

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return ref
}

function createLinkedSpringRef2D(
  leaderRef: Spring2DRefWithInstance,
  options: UseSpringOptions | undefined,
): SpringRef2D {
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  const spring = system.createSpring2D({ target: leaderRef[Spring2DInstanceKey] }, config.value)
  return createReactiveSpringRef(spring, config, Spring2DInstanceKey)
}
