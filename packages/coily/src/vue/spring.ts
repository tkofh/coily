import { type MaybeRefOrGetter, toValue, watchSyncEffect } from 'vue'
import type { Shape } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from '../spring-source.ts'
import {
  type ReactiveSpringRef,
  type UseSpringConfig,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
} from './reactive-spring.ts'
import {
  type AnyShape,
  type CompositeSpringRef,
  type UseCompositeSpringConfig,
  createLinkedCompositeSpringRef,
  createCompositeSpringRef,
  hasCompositeSpringInstance,
} from './composite-spring.ts'

/**
 * The reactive handle for a scalar spring. It is a writable ref of the
 * animated number. It carries `velocity`, `timeRemaining`, and
 * `isResting` refs, plus `settled` and `jumpTo`. Writing the main ref
 * displaces the spring, and it springs back. To move it, change the
 * target you passed to `useSpring`.
 */
export interface SpringRef extends ReactiveSpringRef<number> {}

// Brands a SpringRef with its backing Spring, so useSpring(ref) can chain
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
 * is a number to animate toward, or a `SpringSource` to follow, or a ref
 * or getter of either. A source can be another `useSpring` ref, a
 * `mapSpring` result, or a pooled `Spring`.
 *
 * When a reactive number changes, it retargets the spring, and the
 * spring keeps its momentum. A getter of a source follows a new source
 * when the getter's own dependencies change, so
 * `useSpring(() => (split.value ? left : right))` switches leaders while
 * they move. When a reactive `config` changes, the spring reconfigures in
 * place. While the spring follows a source, `config` sets the follower's
 * own motion, and the leader's config has no effect on it.
 *
 * The spring subscribes to a followed source directly, not through Vue
 * reactivity. Effects and getters therefore never gain a dependency on
 * the leader's animation.
 *
 * Call it during `setup()` below a provided spring system: the
 * coily/nuxt module, or `useSpringSystem()` in an ancestor. The spring
 * is disposed with the component's scope. You can call it in a loop to
 * create one independent spring per target.
 *
 * `options.purpose` marks what the spring animates. A `'nonmotion'`
 * spring, such as a cross-fade or a color, keeps animating under reduced
 * motion. A `'motion'` spring, the default, snaps. `useSpring` reads it
 * once, so unlike `config` it is not reactive.
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
 * Creates a composite spring that follows another `useSpring` object ref
 * channel by channel and animates toward the leader's live values.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: CompositeSpringRef<T>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring over a numeric shape and returns a
 * `CompositeSpringRef`. The shape is a plain object or array whose
 * leaves are all numbers, or a ref or getter of one. Reads return the
 * deep-readonly composite value, and writes take partial shapes. The
 * shape is fixed at creation.
 *
 * A reactive target retargets the channels, and they keep their
 * momentum. A ref retargets when you replace its value or mutate a
 * nested channel. A getter retargets when its reactive dependencies
 * change. A reactive `config` takes a per-channel config shape.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 *
 * `options.purpose` sets reduced-motion behavior per channel: one
 * `Purpose` for all channels, or a shape that mirrors the value.
 * `useSpring` reads it once, so unlike `config` it is not reactive.
 */
export function useSpring<T extends object>(
  target: MaybeRefOrGetter<T & Shape<T>>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
/**
 * Creates a composite spring driven by a getter of a numeric shape. The
 * channels retarget when the getter's reactive dependencies change. The
 * shape is fixed at creation.
 *
 * This is the getter case of the shape overload above. It is a separate
 * overload because TypeScript cannot infer the shape through the
 * function member of `MaybeRefOrGetter`.
 *
 * Call it during `setup()` below a provided spring system. The springs
 * are disposed with the component's scope.
 */
export function useSpring<T extends object>(
  target: () => T & Shape<T>,
  config?: UseCompositeSpringConfig<T>,
  options?: CompositeSpringOptions<T>,
): CompositeSpringRef<T>
export function useSpring(
  target: unknown,
  config?: unknown,
  options?: unknown,
): SpringRef | CompositeSpringRef<AnyShape> {
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(
      target,
      config as UseSpringConfig,
      options as SpringOptions | undefined,
    )
  }
  if (hasCompositeSpringInstance(target)) {
    return createLinkedCompositeSpringRef(
      target,
      config as UseCompositeSpringConfig<AnyShape>,
      options as CompositeSpringOptions<AnyShape> | undefined,
    )
  }
  // A source is followed as itself. A `RampRef` is also a ref, and
  // unwrapping it would read its number and retarget on every update
  // instead of following.
  if (isSpringSource(target)) {
    return createSpringRef(
      () => target as SpringSource,
      config as UseSpringConfig,
      options as SpringOptions | undefined,
    )
  }
  const resolved = toValue(target as MaybeRefOrGetter<unknown>)
  if (typeof resolved === 'number' || isSpringSource(resolved)) {
    return createSpringRef(
      target as MaybeRefOrGetter<number | SpringSource>,
      config as UseSpringConfig,
      options as SpringOptions | undefined,
    )
  }
  return createCompositeSpringRef(
    target as MaybeRefOrGetter<AnyShape>,
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
  // A source target starts the spring at rest at the source's current
  // value. The target effect below attaches the follow.
  const initial = toValue(target)
  const spring = system.createSpring(
    typeof initial === 'number' ? initial : initial[SpringSourceSymbol].value,
    resolvedConfig.value,
    options,
  )
  const ref = createReactiveSpringRef(spring, resolvedConfig, SpringInstanceKey)

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return ref
}

function createLinkedSpringRef(
  leaderRef: SpringRefWithInstance,
  config: UseSpringConfig | undefined,
  options: SpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const leader = leaderRef[SpringInstanceKey]
  const resolvedConfig = resolveSpringConfig(config)
  const spring = system.createSpring(leader, resolvedConfig.value, options)
  return createReactiveSpringRef(spring, resolvedConfig, SpringInstanceKey)
}
