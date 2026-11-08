import { type ComputedRef, type MaybeRefOrGetter, computed, toValue, watchSyncEffect } from 'vue'
import {
  type CompositeSpringTarget,
  type ConfigShape,
  type PartialShape,
  type ReadonlyShape,
  type Shape,
  type TargetShape,
  CompositeSpring,
} from '../composite-spring.ts'
import { isSpringSource } from '../spring-source.ts'
import type { CompositeSpringOptions } from '../system.ts'
import { invariant } from '../util.ts'
import {
  type ReactiveSpringRef,
  createReactiveSpringRef,
  injectSpringSystem,
  toSourceValue,
} from './reactive-spring.ts'

/**
 * Config for an object `useSpring`: a `ConfigShape`, or a ref or getter
 * of one. A `ConfigShape` is one `SpringDefinition` for every channel,
 * `null` for the default, or a shape with configs at any level. A
 * changed reactive config reconfigures the channels in place.
 *
 * Each config position takes only a `SpringDefinition` from
 * `defineSpring`. A plain object reads as a nested level of the shape,
 * never as spring options.
 */
export type UseCompositeSpringConfig<T extends object> = MaybeRefOrGetter<
  ConfigShape<T> | undefined
>

/**
 * The ref an object `useSpring` returns. Reads return the deep-readonly
 * composite value, and writes accept partial shapes. It carries
 * `velocity`, `timeRemaining`, and `isResting` refs plus `settled` and
 * `jumpTo`. Writing it displaces the named channels, which spring back.
 * To move them, change the target passed to `useSpring`.
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

/**
 * What an object `useSpring` can follow as a whole: a composite spring,
 * or the `CompositeSpringRef` of one.
 */
export type CompositeLeader<T extends object> = CompositeSpring<T> | CompositeSpringRef<T>

type CompositeSpringRefWithInstance<T extends object> = CompositeSpringRef<T> & {
  [CompositeSpringInstanceKey]: CompositeSpring<T>
}

function hasCompositeSpringInstance(
  value: unknown,
): value is CompositeSpringRefWithInstance<AnyShape> {
  return typeof value === 'object' && value !== null && CompositeSpringInstanceKey in value
}

/** The composite that `value` leads with, or `undefined` when it is not a `CompositeLeader`. */
function compositeLeaderOf(value: unknown): CompositeSpring<AnyShape> | undefined {
  if (value instanceof CompositeSpring) return value
  if (hasCompositeSpringInstance(value)) return value[CompositeSpringInstanceKey]
  return undefined
}

const SHAPED_SOURCE =
  'useSpring follows a scalar SpringSource or a composite spring, not a source of another shape. Derive a scalar source with mapSpring'

function resolveConfigShape<T extends object>(
  config: UseCompositeSpringConfig<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  return computed(() => toValue(config))
}

/**
 * Creates the composite behind an object `useSpring`. `target` resolves
 * to a shape to animate toward or a `CompositeLeader` to follow, and it
 * can switch between them.
 */
export function createCompositeSpringRef<T extends object>(
  target: MaybeRefOrGetter<(T & Shape<T>) | CompositeLeader<T>>,
  config: UseCompositeSpringConfig<T> | undefined,
  options: CompositeSpringOptions<T> | undefined,
): CompositeSpringRef<T> {
  const system = injectSpringSystem()
  const resolvedConfig = resolveConfigShape(config)
  const resolve = (): CompositeSpringTarget<T> => {
    const next = toSourceValue(target)
    const leader = compositeLeaderOf(next) as CompositeSpring<T> | undefined
    if (leader !== undefined) return leader
    invariant(!isSpringSource(next), SHAPED_SOURCE)
    return next as TargetShape<T>
  }
  const initial = resolve()
  // A leader's value is a live mirror, and `createSpring` copies it.
  const spring = system.createSpring<T>(
    (initial instanceof CompositeSpring ? initial.value : initial) as T & Shape<T>,
    resolvedConfig.value,
    options,
  )
  const ref = createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    resolvedConfig,
    CompositeSpringInstanceKey,
  )

  watchSyncEffect(() => {
    spring.target = resolve()
  })

  return ref
}
