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
import { SpringConfig, type SpringOptions } from '../config.ts'
import type { SpringSystem } from '../system.ts'
import { injectLocal } from './local.ts'
import { SpringSystemKey } from './system.ts'

export type UseSpringOptions = MaybeRefOrGetter<SpringOptions | SpringConfig | undefined>

/**
 * The subset of Spring / Spring2D / SpringObject the reactive bridge relies
 * on. Springs read `V` but may accept a wider write type `W` (spring objects
 * take partial shapes), and configure with `C` (spring objects take config
 * shapes).
 */
interface SpringLike<V, W, C> {
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

export interface ReactiveSpringRef<V, W = V> extends Ref<V, W> {
  readonly velocity: Ref<V, W>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  /** Resolves when the spring next comes to rest — see `Spring#settled`. */
  readonly settled: Promise<void>
  readonly jumpTo: (value: W) => void
}

/**
 * `customRef` is invariant in its single type parameter, but springs read
 * `V` while accepting the wider `W` — the same divergence `Ref<V, W>`
 * models. This alias re-types it; the factories behave identically.
 */
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
  options: UseSpringOptions | undefined,
): ComputedRef<SpringConfig | undefined> {
  return computed(() => {
    const opts = toValue(options)
    if (opts instanceof SpringConfig) return opts
    return opts ? new SpringConfig(opts) : undefined
  })
}

/**
 * Wraps a spring in a writable ref of its value, with `velocity`,
 * `timeRemaining`, and `isResting` refs plus `jumpTo()` attached. Keeps the
 * spring's config in sync with `config`, disposes the spring with the current
 * scope, and stores the spring instance on the ref under `instanceKey` so
 * sibling composables can link to it.
 */
export function createReactiveSpringRef<V, W, C>(
  spring: SpringLike<V, W, C>,
  config: ComputedRef<C | undefined>,
  instanceKey: symbol,
): ReactiveSpringRef<V, W> {
  watchSyncEffect(() => {
    spring.config = config.value ?? null
  })

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

  // A getter so each access reflects the spring's current motion cycle —
  // Object.assign would snapshot a single promise instance.
  Object.defineProperty(ref, 'settled', {
    get: () => spring.settled,
  })
  Object.defineProperty(ref, instanceKey, { value: spring })

  return ref
}
