import { type MaybeRefOrGetter, toValue, watchSyncEffect } from 'vue'
import type { Shape } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from '../spring-source.ts'
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
 * Creates a scalar spring and returns it as a `SpringRef`. The target
 * is a number to animate toward, or a `SpringSource` to follow — another
 * `useSpring` ref, a `mapSpring` result, a pooled `Spring` — or a
 * ref/getter of either. Reactive numbers retarget the spring whenever
 * they change, momentum intact; a getter of a source re-follows when its
 * own dependencies change, so `useSpring(() => (split.value ? left :
 * right))` switches leaders live. Reactive `options` reconfigure the
 * spring in place; while following, they configure the follower's own
 * motion — the leader's config plays no part.
 *
 * Following bypasses Vue reactivity — the spring subscribes to the
 * source directly — so effects and getters never gain a dependency on a
 * leader's animation.
 *
 * Call it during `setup()` below a provided spring system (the
 * coily/nuxt module, or `useSpringSystem()` in an ancestor). The spring
 * is disposed with the component's scope, and composables are loop-safe:
 * map over targets for several independent springs.
 *
 * `springOptions.purpose` marks what the spring animates — `'appearance'`
 * (a cross-fade, a color) keeps animating under reduced motion, `'motion'`
 * (the default) snaps. It is read once, so unlike `options` it is not
 * reactive.
 *
 * @example
 * ```ts
 * const target = ref(0)
 * const x = useSpring(target, { duration: 500, bounce: 0.3 })
 * // template: <div :style="{ translate: `${x}px 0` }" @click="target = 300" />
 *
 * const opacity = useSpring(shown ? 1 : 0, undefined, { purpose: 'appearance' })
 * ```
 */
export function useSpring(
  target: MaybeRefOrGetter<number | SpringSource>,
  options?: UseSpringOptions,
  springOptions?: SpringOptions,
): SpringRef
/**
 * Creates a composite spring that follows another `useSpring` object ref
 * channel by channel, animating toward the leader's live values.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: CompositeSpringRef<T>,
  options?: UseCompositeSpringOptions<T>,
  springOptions?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring over a numeric shape — a plain object or
 * array whose leaves are all numbers, or a ref/getter of one — and
 * returns a `CompositeSpringRef`: reads are the deep-readonly composite
 * value, writes take partial shapes. The shape is fixed at creation.
 * Reactive targets retarget the channels, momentum intact — a ref on
 * replacement or nested mutation, a getter whenever its reactive
 * dependencies change. Reactive `options` accept a per-channel config
 * shape.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 *
 * `springOptions.purpose` marks reduced-motion behavior per channel: a
 * single `Purpose` for all, or a shape mirroring the value. It is read
 * once, so unlike `options` it is not reactive.
 */
export function useSpring<T extends object>(
  target: MaybeRefOrGetter<T & Shape<T>>,
  options?: UseCompositeSpringOptions<T>,
  springOptions?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring driven by a getter of a numeric shape: the
 * springs retarget whenever the getter's reactive dependencies change.
 * The shape itself is fixed at creation.
 *
 * (This is the getter case of the shape overload above, split out
 * because the shape doesn't infer through `MaybeRefOrGetter`'s
 * function member.)
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: () => T & Shape<T>,
  options?: UseCompositeSpringOptions<T>,
  springOptions?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
export function useSpring(
  target: unknown,
  options?: unknown,
  springOptions?: unknown,
): SpringRef | CompositeSpringRef<AnyShape> {
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(
      target,
      options as UseSpringOptions,
      springOptions as SpringOptions | undefined,
    )
  }
  if (hasCompositeSpringInstance(target)) {
    return createLinkedCompositeSpringRef(
      target,
      options as UseCompositeSpringOptions<AnyShape>,
      springOptions as CompositeSpringOptions<AnyShape> | undefined,
    )
  }
  const resolved = toValue(target as MaybeRefOrGetter<unknown>)
  if (typeof resolved === 'number' || isSpringSource(resolved)) {
    return createSpringRef(
      target as MaybeRefOrGetter<number | SpringSource>,
      options as UseSpringOptions,
      springOptions as SpringOptions | undefined,
    )
  }
  return createCompositeSpringRef(
    target as MaybeRefOrGetter<AnyShape>,
    options as UseCompositeSpringOptions<AnyShape>,
    springOptions as CompositeSpringOptions<AnyShape> | undefined,
  )
}

function createSpringRef(
  target: MaybeRefOrGetter<number | SpringSource>,
  options: UseSpringOptions | undefined,
  springOptions: SpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  // A source target starts the spring at rest at the source's current
  // value; the target effect below attaches the follow.
  const initial = toValue(target)
  const spring = system.createSpring(
    typeof initial === 'number' ? initial : initial[SpringSourceSymbol].value,
    config.value,
    springOptions,
  )
  const ref = createReactiveSpringRef(spring, config, SpringInstanceKey)

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return ref
}

function createLinkedSpringRef(
  leaderRef: SpringRefWithInstance,
  options: UseSpringOptions | undefined,
  springOptions: SpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const leader = leaderRef[SpringInstanceKey]
  const config = resolveSpringConfig(options)
  const spring = system.createSpring(leader, config.value, springOptions)
  return createReactiveSpringRef(spring, config, SpringInstanceKey)
}
