import { type MaybeRef, type MaybeRefOrGetter, watchSyncEffect } from 'vue'
import type { CompositeSpring, Shape } from '../composite-spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from '../spring-source.ts'
import {
  type ReactiveSpringRef,
  type UseSpringConfig,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
  toSourceValue,
} from './reactive-spring.ts'
import {
  type AnyShape,
  type CompositeSpringRef,
  type UseCompositeSpringConfig,
  createCompositeSpringRef,
} from './composite-spring.ts'

/**
 * The writable ref a scalar `useSpring` returns, carrying `velocity`,
 * `timeRemaining`, and `isResting` refs plus `settled` and `jumpTo`.
 * Writing it displaces the spring, which springs back. To move it,
 * change the target passed to `useSpring`.
 */
export interface SpringRef extends ReactiveSpringRef<number> {}

/**
 * Creates a scalar spring and returns it as a `SpringRef`. The target is
 * a number to animate toward or a `SpringSource` to follow (another
 * `useSpring` ref, a `mapSpring` result, or a pooled `Spring`), or a ref
 * or getter of either. A pooled `Spring` or `Ramp` inside a deep `ref` or
 * `reactive` is followed through Vue's proxy, but hold it in a
 * `shallowRef` or `markRaw` anyway: see `SpringPool`.
 *
 * A changed reactive number retargets the spring, which keeps its
 * momentum. A getter of a source re-follows when its own dependencies
 * change, so `useSpring(() => (split.value ? left : right))` switches
 * leaders mid-flight. A changed reactive `config` reconfigures the
 * spring in place. While following, the spring uses its own `config`,
 * never the leader's.
 *
 * The spring subscribes to a followed source directly, so no effect or
 * getter gains a dependency on the leader's animation.
 *
 * Call it during `setup()` below a provided spring system (the coily/nuxt
 * module, or `useSpringSystem()` in an ancestor). It throws without one.
 * The spring is disposed with the component's scope.
 *
 * `options.purpose` is read once, at creation. Under reduced motion, a
 * `'motion'` spring, the default, snaps. A `'nonmotion'` spring, such as
 * a cross-fade or a color, keeps animating.
 *
 * @example
 * ```ts
 * const target = ref(0)
 * const x = useSpring(target, { duration: 500, bounce: 0.3 })
 * // template: <div :style="{ translate: `${x}px 0` }" @click="target = 300" />
 *
 * const shown = ref(false)
 * const opacity = useSpring(() => (shown.value ? 1 : 0), undefined, { purpose: 'nonmotion' })
 * ```
 */
export function useSpring(
  target: MaybeRefOrGetter<number | SpringSource>,
  config?: UseSpringConfig,
  options?: SpringOptions,
): SpringRef
/**
 * Creates a composite spring that follows a leader channel by channel,
 * animating toward its live values. The leader is an object `useSpring`
 * ref or a pooled `CompositeSpring` of the same shape. A ref of a
 * leader, such as a `computed`, works too, and the spring follows each
 * new leader the ref holds.
 *
 * Call it during `setup()` below a provided spring system. It throws
 * without one. The springs are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: MaybeRef<CompositeSpringRef<T> | CompositeSpring<T>>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring over a numeric shape and returns a
 * `CompositeSpringRef`. The shape is a plain object or array whose
 * leaves are all numbers, or a ref or getter of one, and it is fixed at
 * creation. Reads return the deep-readonly value, and writes take
 * partial shapes.
 *
 * A reactive target retargets the channels, which keep their momentum.
 * A ref retargets when you replace its value or mutate a nested channel.
 * `config` takes a per-channel config shape and may be reactive.
 *
 * Call it during `setup()` below a provided spring system. It throws
 * without one. The springs are disposed with the component's scope.
 *
 * `options.purpose` sets reduced-motion behavior per channel: one
 * `Purpose` for all channels, or a shape that mirrors the value. It is
 * read once, at creation.
 */
export function useSpring<T extends object>(
  target: MaybeRefOrGetter<T & Shape<T>>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
// Separate from the shape and leader overloads because TypeScript cannot
// infer `T` through the function member of `MaybeRefOrGetter`.
/**
 * Creates a composite spring driven by a getter that returns a numeric
 * shape to animate toward, or a leader to follow (an object `useSpring`
 * ref or a pooled `CompositeSpring`). When the getter's dependencies
 * change, the spring retargets or follows the new leader, so
 * `useSpring(() => (split.value ? left : right))` switches leaders
 * mid-flight. Every shape and leader must match the spring's shape,
 * which is fixed at creation.
 *
 * Call it during `setup()` below a provided spring system. It throws
 * without one. The springs are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: () => (T & Shape<T>) | CompositeSpringRef<T> | CompositeSpring<T>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
export function useSpring(
  target: unknown,
  config?: unknown,
  options?: unknown,
): SpringRef | CompositeSpringRef<AnyShape> {
  // A `SpringRef`, `RampRef`, or `CompositeSpringRef` is also a ref.
  // Unwrapping it would retarget to its value on every update instead of
  // following it.
  const follow = isSpringSource(target) ? () => target : (target as MaybeRefOrGetter<unknown>)
  const resolved = toSourceValue(follow)
  if (
    typeof resolved === 'number' ||
    (isSpringSource(resolved) && typeof resolved[SpringSourceSymbol].value === 'number')
  ) {
    return createSpringRef(
      follow as MaybeRefOrGetter<number | SpringSource>,
      config as UseSpringConfig,
      options as SpringOptions | undefined,
    )
  }
  // Shapes and composite leaders. The composite path rejects any other
  // shape-valued source that lands here.
  return createCompositeSpringRef(
    follow as MaybeRefOrGetter<AnyShape>,
    config as UseCompositeSpringConfig<AnyShape>,
    options as CompositeSpringOptions<AnyShape> | undefined,
  )
}

function createSpringRef(
  target: MaybeRefOrGetter<number | SpringSource>,
  config: UseSpringConfig | undefined,
  options: SpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const resolvedConfig = resolveSpringConfig(config)
  // A source starts the spring at rest on its current value. The effect
  // below attaches the follow.
  const initial = toSourceValue(target)
  const spring = system.createSpring(
    typeof initial === 'number' ? initial : initial[SpringSourceSymbol].value,
    resolvedConfig.value,
    options,
  )
  const ref = createReactiveSpringRef(spring, resolvedConfig, null)

  watchSyncEffect(() => {
    spring.target = toSourceValue(target)
  })

  return ref
}
