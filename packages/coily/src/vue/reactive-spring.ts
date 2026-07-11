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
  readonly settled: Promise<void>
  readonly jumpTo: (value: W) => void
}

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

  Object.defineProperty(ref, 'settled', {
    get: () => spring.settled,
  })
  Object.defineProperty(ref, instanceKey, { value: spring })

  return ref
}
