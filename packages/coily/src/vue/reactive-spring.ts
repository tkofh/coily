import {
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
  computed,
  customRef,
  getCurrentScope,
  onScopeDispose,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringDefinition, type SpringDefinitionOptions } from '../config.ts'
import { type SpringSource, type SpringSourceApi, SpringSourceSymbol } from '../spring-source.ts'
import type { SpringSystem } from '../system.ts'
import { injectLocal } from './local.ts'
import { SpringSystemKey } from './system.ts'

/**
 * Config for a scalar `useSpring`: a `SpringDefinition`, any option shape
 * `defineSpring` accepts, or a ref/getter of either. Reactive config
 * reconfigures the spring in place when it changes; `undefined` means the
 * default config.
 */
export type UseSpringConfig = MaybeRefOrGetter<
  SpringDefinitionOptions | SpringDefinition | undefined
>

/** The spring surface the reactive wrapper needs — satisfied by both `Spring` and `CompositeSpring`. */
interface SpringLike<V, W, C> {
  readonly [SpringSourceSymbol]: SpringSourceApi<V>
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
 * The reactive surface `useSpring` returns: a writable ref of the
 * animated value with the rest of the spring attached. Reads track
 * reactively and update once per tick while the spring moves.
 *
 * Writing the main ref displaces the spring — it springs back toward its
 * target. To move the spring, drive the target you passed to
 * `useSpring`.
 *
 * The ref is also a `SpringSource`: it goes anywhere a source does —
 * another `useSpring`, a `mapSpring` leaf, a composite channel target.
 * Followers read the backing spring through `SpringSourceSymbol`, never
 * through the ref's tracked getter, so following registers no Vue
 * dependencies — an effect that touches a follower's leader stays
 * independent of the leader's animation.
 */
export interface ReactiveSpringRef<V, W = V> extends Ref<V, W>, SpringSource<V> {
  /**
   * The current velocity in value units per second, as a writable ref.
   * Writing flings the spring; it settles back to its target.
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
   * A promise that resolves when the spring next comes to rest — already
   * resolved while resting. Retargeting mid-flight extends the wait;
   * disposal resolves it.
   */
  readonly settled: Promise<void>
  /** Snaps the spring to `value` with no animation, target included. */
  readonly jumpTo: (value: W) => void
}

// customRef's public typing fixes get and set to one type; spring refs
// read composites (deep-readonly) but accept partials on write, so the
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
  instanceKey: symbol,
): ReactiveSpringRef<V, W> {
  watchSyncEffect(() => {
    spring.config = config.value ?? null
  })

  // Triggers are captured lazily on first read, so refs nobody reads
  // never pay for per-tick invalidation.
  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })

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

  // A getter so each read returns the spring's current settled promise,
  // not one captured at creation.
  Object.defineProperty(ref, 'settled', {
    get: () => spring.settled,
  })
  Object.defineProperty(ref, instanceKey, { value: spring })
  // The source slot hands followers the backing spring's own api, so
  // their reads bypass the customRef getter and can never track into an
  // active effect.
  Object.defineProperty(ref, SpringSourceSymbol, { value: spring[SpringSourceSymbol] })

  return ref
}
