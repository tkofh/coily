import { type MaybeRefOrGetter, type Ref, toValue, watchSyncEffect } from 'vue'
import type { Shape } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import {
  type ReactiveSpringRef,
  type UseSpringOptions,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
} from './reactive-spring.ts'
import {
  type AnyShape,
  type CompositeSpringRef,
  type UseCompositeSpringOptions,
  createLinkedCompositeSpringRef,
  createCompositeSpringRef,
  hasCompositeSpringInstance,
} from './composite-spring.ts'

export type { UseSpringOptions } from './reactive-spring.ts'

/**
 * The reactive handle for a scalar spring: a writable ref of the
 * animated number, with `velocity`, `timeRemaining`, and `isResting`
 * refs plus `settled` and `jumpTo` attached. Writing the main ref
 * displaces the spring; drive the `useSpring` target to move it.
 */
export interface SpringRef extends ReactiveSpringRef<number> {}

// Brands a SpringRef with its backing Spring so useSpring(ref) can chain
// from it without exposing the instance on the public type.
const SpringInstanceKey = Symbol('spring')

interface SpringRefWithInstance extends SpringRef {
  readonly [SpringInstanceKey]: Spring
}

function hasSpringInstance(value: unknown): value is SpringRefWithInstance {
  return typeof value === 'object' && value !== null && SpringInstanceKey in value
}

/**
 * Creates a spring animating toward `target` — a number, ref, or getter
 * — and returns it as a `SpringRef`. Reactive targets retarget the
 * spring whenever they change, momentum intact; reactive `options`
 * reconfigure it in place.
 *
 * Call it during `setup()` below a provided spring system (the
 * coily/nuxt module, or `useSpringSystem()` in an ancestor). The spring
 * is disposed with the component's scope, and composables are loop-safe:
 * map over targets for several independent springs.
 *
 * @example
 * ```ts
 * const target = ref(0)
 * const x = useSpring(target, { duration: 500, bounce: 0.3 })
 * // template: <div :style="{ translate: `${x}px 0` }" @click="target = 300" />
 * ```
 */
export function useSpring(target: MaybeRefOrGetter<number>, options?: UseSpringOptions): SpringRef
/**
 * Creates a spring that follows another `useSpring` ref's live value,
 * momentum intact. Without `options` the follower uses the leader's
 * config; with them, its own.
 *
 * Call it during `setup()` below a provided spring system. The spring is
 * disposed with the component's scope.
 */
export function useSpring(target: SpringRef, options?: UseSpringOptions): SpringRef
/**
 * Creates a composite spring that follows another `useSpring` object ref
 * channel by channel. Channels animate toward the leader's live values;
 * without `options` each uses its leader channel's config.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: CompositeSpringRef<T>,
  options?: UseCompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring over a numeric shape — a plain object or
 * array whose leaves are all numbers — and returns a `CompositeSpringRef`:
 * reads are the deep-readonly composite value, writes take partial
 * shapes. The shape is fixed at creation; reactive `options` accept a
 * per-channel config shape.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: T & Shape<T>,
  options?: UseCompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring driven by a reactive numeric shape: any
 * change to the ref — replacement or nested mutation — retargets the
 * springs, momentum intact. The shape itself is fixed at creation.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: Ref<T & Shape<T>>,
  options?: UseCompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring driven by a getter of a numeric shape: the
 * springs retarget whenever the getter's reactive dependencies change.
 * The shape itself is fixed at creation.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: () => T & Shape<T>,
  options?: UseCompositeSpringOptions<T>,
): CompositeSpringRef<T>
export function useSpring(
  target: unknown,
  options?: unknown,
): SpringRef | CompositeSpringRef<AnyShape> {
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(target, options as UseSpringOptions)
  }
  if (hasCompositeSpringInstance(target)) {
    return createLinkedCompositeSpringRef(target, options as UseCompositeSpringOptions<AnyShape>)
  }
  if (typeof toValue(target as MaybeRefOrGetter<unknown>) === 'number') {
    return createSpringRef(target as MaybeRefOrGetter<number>, options as UseSpringOptions)
  }
  return createCompositeSpringRef(
    target as MaybeRefOrGetter<AnyShape>,
    options as UseCompositeSpringOptions<AnyShape>,
  )
}

function createSpringRef(
  target: MaybeRefOrGetter<number>,
  options: UseSpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  const spring = system.createSpring(toValue(target), config.value)
  const ref = createReactiveSpringRef(spring, config, SpringInstanceKey)

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return ref
}

function createLinkedSpringRef(
  leaderRef: SpringRefWithInstance,
  options: UseSpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const leader = leaderRef[SpringInstanceKey]
  const config = resolveSpringConfig(options)
  const spring = system.createSpring(leader, config.value)
  return createReactiveSpringRef(spring, config, SpringInstanceKey)
}
