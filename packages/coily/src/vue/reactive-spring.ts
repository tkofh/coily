import {
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  computed,
  customRef,
  getCurrentScope,
  onScopeDispose,
  toRaw,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringDefinition, type SpringDefinitionOptions } from '../config.ts'
import type { TargetedSource, TargetedSourceApi } from '../kinematic-source.ts'
import { SpringSourceSymbol, isSpringSource } from '../spring-source.ts'
import type { SpringSystem } from '../system.ts'
import { injectLocal } from './local.ts'
import { SpringSystemKey } from './system.ts'

/**
 * `toValue`, with a core source unwrapped from any Vue proxy. A `ref` or
 * `reactive` container deep-proxies a `Spring` or `Ramp`, and their brand
 * getters read private fields, which a proxy cannot reach. Plain shapes
 * stay proxied, so effects still track their nested channels.
 */
export function toSourceValue<T>(target: MaybeRefOrGetter<T>): T {
  const value = toValue(target)
  return isSpringSource(value) ? toRaw(value) : value
}

/**
 * Config for a scalar `useSpring`: a `SpringDefinition`, any option shape
 * `defineSpring` accepts, or a ref or getter of either. A changed
 * reactive config reconfigures the spring in place. `undefined` means
 * the default config.
 */
export type UseSpringConfig = MaybeRefOrGetter<
  SpringDefinitionOptions | SpringDefinition | undefined
>

/** The spring members the reactive wrapper uses. `Spring` and `CompositeSpring` both have them. */
interface SpringLike<V, W, C> {
  readonly [SpringSourceSymbol]: TargetedSourceApi<V>
  get value(): V
  set value(next: W)
  get velocity(): V
  set velocity(next: W)
  readonly timeRemaining: number
  readonly isResting: boolean
  readonly settled: Promise<void>
  set config(value: C | null)
  jumpTo(value: W): void
  dispose(): void
  onUpdate(callback: () => void): () => void
  onStart(callback: () => void): () => void
  onStop(callback: () => void): () => void
}

/**
 * The ref `useSpring` returns: a writable ref of the animated value, with
 * the rest of the spring attached. It triggers once per frame while the
 * spring moves. Writing it displaces the spring, which springs back
 * toward its target. To move the spring, change the target passed to
 * `useSpring`.
 *
 * The ref is a `TargetedSource`, so another `useSpring` can follow it,
 * and `velocityOf`, `accelerationOf`, and `targetOf` accept it. A scalar
 * ref also works as a `mapSpring` leaf or a composite channel target.
 * Followers read the backing spring directly, so following never adds a
 * Vue dependency, even inside an effect that moves the leader.
 */
export interface ReactiveSpringRef<V, W = V> extends Ref<V, W>, TargetedSource<V> {
  /**
   * The current velocity in value units per second, as a writable ref.
   * Writing flings the spring, and it settles back to its target.
   */
  readonly velocity: Ref<V, W>
  /**
   * Estimated milliseconds until the spring rests, as a reactive ref: 0
   * while resting. Writes are ignored.
   */
  readonly timeRemaining: Ref<number>
  /** Whether the spring is resting, as a reactive ref. Writes are ignored. */
  readonly isResting: Ref<boolean>
  /**
   * A promise that resolves when the spring next comes to rest. It is
   * already resolved while the spring rests. A retarget mid-flight
   * extends the wait, and disposal resolves it.
   */
  readonly settled: Promise<void>
  /**
   * Snaps the spring to `value` with no animation, target included. The
   * spring rests there until the target you passed to `useSpring`
   * changes, or until a leader it follows moves.
   */
  readonly jumpTo: (value: W) => void
}

// The public type of customRef gives get and set one type. Spring refs
// read deep-readonly composites but accept partials on write, so the
// cast recovers a divergent Ref<G, S>.
const divergentRef = customRef as unknown as <G, S>(
  factory: (track: () => void, trigger: () => void) => { get(): G; set(value: S): void },
) => Ref<G, S>

export function injectSpringSystem(): SpringSystem {
  const system = injectLocal(SpringSystemKey)

  if (!system) {
    throw new Error(
      'No SpringSystem found — install the coily/nuxt module or call useSpringSystem() in an ancestor component',
    )
  }

  return system
}

export function resolveSpringConfig(
  config: UseSpringConfig | undefined,
): ComputedRef<SpringDefinition | undefined> {
  return computed(() => {
    const resolved = toValue(config)
    if (resolved instanceof SpringDefinition) return resolved
    return resolved ? new SpringDefinition(resolved) : undefined
  })
}

export function createReactiveSpringRef<V, W, C>(
  spring: SpringLike<V, W, C>,
  config: ComputedRef<C | undefined>,
  instanceKey: symbol | null,
): ReactiveSpringRef<V, W> {
  watchSyncEffect(() => {
    spring.config = config.value ?? null
  })

  // Each trigger is captured on the first read, so the update handler
  // skips refs nobody has read.
  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })
  // A retarget from rest changes the remaining time without an update
  // until the next frame, so start and stop trigger it too.
  const triggerRemaining = () => triggerTimeRemaining?.()
  spring.onStart(triggerRemaining)
  spring.onStop(triggerRemaining)

  const value = divergentRef<V, W>((track, trigger) => ({
    get() {
      triggerValue ??= trigger
      track()
      return spring.value
    },
    set(next) {
      spring.value = next
      trigger()
    },
  }))

  const velocity = divergentRef<V, W>((track, trigger) => ({
    get() {
      triggerVelocity ??= trigger
      track()
      return spring.velocity
    },
    set(next) {
      spring.velocity = next
      trigger()
    },
  }))

  const timeRemaining = customRef((track, trigger) => ({
    get() {
      triggerTimeRemaining ??= trigger
      track()
      return spring.timeRemaining
    },
    set() {},
  }))

  const isResting = customRef((track, trigger) => {
    spring.onStart(trigger)
    spring.onStop(trigger)

    return {
      get() {
        track()
        return spring.isResting
      },
      set() {},
    }
  })

  if (getCurrentScope()) {
    onScopeDispose(() => spring.dispose())
  }

  const ref = Object.assign(value, {
    velocity,
    timeRemaining,
    isResting,
    jumpTo: (next: W) => spring.jumpTo(next),
  }) as ReactiveSpringRef<V, W>

  // A getter, so reads see the current promise, not the one at creation.
  Object.defineProperty(ref, 'settled', {
    get: () => spring.settled,
  })
  if (instanceKey !== null) Object.defineProperty(ref, instanceKey, { value: spring })
  // Followers get the backing spring's api, so their reads skip the
  // tracked getter.
  Object.defineProperty(ref, SpringSourceSymbol, { value: spring[SpringSourceSymbol] })

  return ref
}
