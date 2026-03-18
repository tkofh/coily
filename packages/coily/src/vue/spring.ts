import {
  type MaybeRefOrGetter,
  type Ref,
  computed,
  customRef,
  inject,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringConfig, type SpringOptions } from '../config.ts'
import { SpringSystemKey } from './system.ts'

export interface SpringRef extends Ref<number> {
  readonly velocity: Ref<number>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  readonly jumpTo: (value: number) => void
}

export const defaultOptions = {
  tension: 100,
  damping: 10,
  precision: 2,
} satisfies SpringOptions

export function useSpring(
  target: MaybeRefOrGetter<number>,
  options?: MaybeRefOrGetter<SpringOptions | SpringConfig | undefined>,
): SpringRef {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const config = computed(() => {
    const opts = toValue(options)
    if (opts instanceof SpringConfig) return opts
    return new SpringConfig(opts ?? defaultOptions)
  })

  const spring = system.createSpring(toValue(target), config.value)

  watchSyncEffect(() => {
    spring.configure(config.value)
  })

  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })

  const value = customRef((track, trigger) => ({
    get() {
      triggerValue ??= trigger
      track()
      return spring.value
    },
    set(value: number) {
      spring.value = value
      trigger()
    },
  }))

  const velocity = customRef((track, trigger) => ({
    get() {
      triggerVelocity ??= trigger
      track()
      return spring.velocity
    },
    set(value: number) {
      spring.velocity = value
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

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return Object.assign(value, {
    velocity,
    timeRemaining,
    isResting,
    jumpTo: (value: number) => spring.jumpTo(value),
  }) as SpringRef
}
