import { type ComputedRef, type MaybeRefOrGetter, computed, toValue, watchSyncEffect } from 'vue'
import type {
  ConfigShape,
  PartialShape,
  ReadonlyShape,
  Shape,
  SpringObject,
} from '../spring-object.ts'
import {
  type ReactiveSpringRef,
  createReactiveSpringRef,
  injectSpringSystem,
} from './reactive-spring.ts'

/**
 * Options for an object `useSpring`: a `ConfigShape` — one `SpringConfig`
 * for every channel, `null`, or a shape with configs at any level — or a
 * ref/getter of one. Reactive options reconfigure channels in place.
 *
 * Unlike scalar options, config positions here take `SpringConfig`
 * instances only (build them with `defineSpring`): a plain object is
 * always read as a per-channel shape.
 */
export type UseSpringObjectOptions<T extends object> = MaybeRefOrGetter<ConfigShape<T> | undefined>

/**
 * The reactive handle for a composite spring: a ref reading the
 * deep-readonly composite value and accepting partial shapes on writes,
 * with `velocity`, `timeRemaining`, and `isResting` refs plus `settled`
 * and `jumpTo` attached. Writing the main ref displaces the named
 * channels; drive the `useSpring` target to move them.
 */
export interface SpringObjectRef<T extends object> extends ReactiveSpringRef<
  ReadonlyShape<T>,
  PartialShape<T>
> {}

// Brands a SpringObjectRef with its backing SpringObject so
// useSpring(ref) can chain from it without exposing the instance on the
// public type.
const SpringObjectInstanceKey = Symbol('spring-object')

export type AnyShape = Record<string, number>

type SpringObjectRefWithInstance<T extends object> = SpringObjectRef<T> & {
  [SpringObjectInstanceKey]: SpringObject<T>
}

export function hasSpringObjectInstance(
  value: unknown,
): value is SpringObjectRefWithInstance<AnyShape> {
  return typeof value === 'object' && value !== null && SpringObjectInstanceKey in value
}

function resolveConfigShape<T extends object>(
  options: UseSpringObjectOptions<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  return computed(() => toValue(options))
}

export function createSpringObjectRef<T extends object>(
  value: MaybeRefOrGetter<T & Shape<T>>,
  options: UseSpringObjectOptions<T> | undefined,
): SpringObjectRef<T> {
  const system = injectSpringSystem()
  const config = resolveConfigShape(options)
  const spring = system.createSpringObject<T>(toValue(value), config.value)
  const ref = createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    SpringObjectInstanceKey,
  )

  watchSyncEffect(() => {
    spring.target = toValue(value) as unknown as PartialShape<T>
  })

  return ref
}

export function createLinkedSpringObjectRef<T extends object>(
  leaderRef: SpringObjectRefWithInstance<T>,
  options: UseSpringObjectOptions<T> | undefined,
): SpringObjectRef<T> {
  const system = injectSpringSystem()
  const leader = leaderRef[SpringObjectInstanceKey]
  const config = resolveConfigShape(options)
  const spring = system.createSpringObject<T>(leader.value as unknown as T & Shape<T>, config.value)
  spring.target = leader
  return createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    SpringObjectInstanceKey,
  )
}
