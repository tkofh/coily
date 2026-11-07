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
 * Config for an object `useSpring`: a `ConfigShape`, or a ref or getter
 * of one. A `ConfigShape` is one `SpringDefinition` for every channel,
 * `null` for the default, or a shape with configs at any level. When a
 * reactive config changes, the channels reconfigure in place.
 *
 * Unlike scalar config, each config position takes only a
 * `SpringDefinition` instance, which `defineSpring` builds. The shape
 * reads a plain object as a nested level of the shape, never as spring
 * options.
 */
export type UseCompositeSpringConfig<T extends object> = MaybeRefOrGetter<
  ConfigShape<T> | undefined
>

/**
 * The reactive handle for a composite spring. It is a ref that reads the
 * deep-readonly composite value and accepts partial shapes on writes. It
 * carries `velocity`, `timeRemaining`, and `isResting` refs, plus
 * `settled` and `jumpTo`. Writing the main ref displaces the named
 * channels, and they spring back. To move them, change the target you
 * passed to `useSpring`.
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
  config: UseCompositeSpringConfig<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  return computed(() => toValue(config))
}

export function createCompositeSpringRef<T extends object>(
  value: MaybeRefOrGetter<T & Shape<T>>,
  config: UseCompositeSpringConfig<T> | undefined,
  options: CompositeSpringOptions<T> | undefined,
): CompositeSpringRef<T> {
  const system = injectSpringSystem()
  const resolvedConfig = resolveConfigShape(config)
  const spring = system.createSpring<T>(toValue(value), resolvedConfig.value, options)
  const ref = createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    resolvedConfig,
    CompositeSpringInstanceKey,
  )

  watchSyncEffect(() => {
    spring.target = toValue(value) as unknown as PartialShape<T>
  })

  return ref
}

export function createLinkedCompositeSpringRef<T extends object>(
  leaderRef: CompositeSpringRefWithInstance<T>,
  config: UseCompositeSpringConfig<T> | undefined,
  options: CompositeSpringOptions<T> | undefined,
): CompositeSpringRef<T> {
  const system = injectSpringSystem()
  const leader = leaderRef[CompositeSpringInstanceKey]
  const resolvedConfig = resolveConfigShape(config)
  const spring = system.createSpring<T>(
    leader.value as unknown as T & Shape<T>,
    resolvedConfig.value,
    options,
  )
  spring.target = leader
  return createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    resolvedConfig,
    CompositeSpringInstanceKey,
  )
}
