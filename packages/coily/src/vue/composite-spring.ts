import { type ComputedRef, type MaybeRefOrGetter, computed, toValue, watchSyncEffect } from 'vue'
import type {
  ConfigShape,
  PartialShape,
  ReadonlyShape,
  Shape,
  CompositeSpring,
} from '../composite-spring.ts'
import type { CompositeSpringOptions } from '../system.ts'
import {
  type ReactiveSpringRef,
  createReactiveSpringRef,
  injectSpringSystem,
} from './reactive-spring.ts'

/**
 * Options for an object `useSpring`: a `ConfigShape` — one `SpringDefinition`
 * for every channel, `null`, or a shape with configs at any level — or a
 * ref/getter of one. Reactive options reconfigure channels in place.
 *
 * Unlike scalar options, config positions here take `SpringDefinition`
 * instances only (build them with `defineSpring`): a plain object is
 * always read as a per-channel shape.
 */
export type UseCompositeSpringOptions<T extends object> = MaybeRefOrGetter<
  ConfigShape<T> | undefined
>

/**
 * The reactive handle for a composite spring: a ref reading the
 * deep-readonly composite value and accepting partial shapes on writes,
 * with `velocity`, `timeRemaining`, and `isResting` refs plus `settled`
 * and `jumpTo` attached. Writing the main ref displaces the named
 * channels; drive the `useSpring` target to move them.
 */
export interface CompositeSpringRef<T extends object> extends ReactiveSpringRef<
  ReadonlyShape<T>,
  PartialShape<T>
> {}

// Brands a CompositeSpringRef with its backing CompositeSpring so
// useSpring(ref) can chain from it without exposing the instance on the
// public type.
const CompositeSpringInstanceKey = Symbol('composite-spring')

export type AnyShape = Record<string, number>

type CompositeSpringRefWithInstance<T extends object> = CompositeSpringRef<T> & {
  [CompositeSpringInstanceKey]: CompositeSpring<T>
}

export function hasCompositeSpringInstance(
  value: unknown,
): value is CompositeSpringRefWithInstance<AnyShape> {
  return typeof value === 'object' && value !== null && CompositeSpringInstanceKey in value
}

function resolveConfigShape<T extends object>(
  options: UseCompositeSpringOptions<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  return computed(() => toValue(options))
}

export function createCompositeSpringRef<T extends object>(
  value: MaybeRefOrGetter<T & Shape<T>>,
  options: UseCompositeSpringOptions<T> | undefined,
  springOptions: CompositeSpringOptions<T> | undefined,
): CompositeSpringRef<T> {
  const system = injectSpringSystem()
  const config = resolveConfigShape(options)
  const spring = system.createSpring<T>(toValue(value), config.value, springOptions)
  const ref = createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    CompositeSpringInstanceKey,
  )

  watchSyncEffect(() => {
    spring.target = toValue(value) as unknown as PartialShape<T>
  })

  return ref
}

export function createLinkedCompositeSpringRef<T extends object>(
  leaderRef: CompositeSpringRefWithInstance<T>,
  options: UseCompositeSpringOptions<T> | undefined,
  springOptions: CompositeSpringOptions<T> | undefined,
): CompositeSpringRef<T> {
  const system = injectSpringSystem()
  const leader = leaderRef[CompositeSpringInstanceKey]
  const config = resolveConfigShape(options)
  const spring = system.createSpring<T>(
    leader.value as unknown as T & Shape<T>,
    config.value,
    springOptions,
  )
  spring.target = leader
  return createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    CompositeSpringInstanceKey,
  )
}
