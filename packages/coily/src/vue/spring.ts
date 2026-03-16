import { type MaybeRefOrGetter, type Ref, computed, customRef, inject, toValue, watchSyncEffect } from 'vue'
import { SpringConfig, type SpringOptions } from '../config.ts'
import { SpringSystemKey } from './system.ts'

interface UseSpringReturn {
  readonly value: Ref<number>
  readonly velocity: Ref<number>
  readonly resting: Readonly<Ref<boolean>>
  readonly jumpTo: (value: number) => void
}

const defaultOptions = {
  tension: 100,
  damping: 10,
  precision: 2,
} satisfies SpringOptions

export function useSpring(
  target: MaybeRefOrGetter<number>,
  options?: MaybeRefOrGetter<SpringOptions>,
): UseSpringReturn {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const config = computed(() => new SpringConfig(toValue(options) ?? defaultOptions))

  const spring = system.createSpring(toValue(target), config.value)

  watchSyncEffect(() => {
    spring.configure(config.value)
  })

  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
  })

  const value = customRef((track, trigger) => {
    triggerValue = trigger

    return {
      get() {
        track()
        return spring.value
      },
      set(value: number) {
        spring.value = value
        trigger()
      },
    }
  })

  const velocity = customRef((track, trigger) => {
    triggerVelocity = trigger

    return {
      get() {
        track()
        return spring.velocity
      },
      set(value: number) {
        spring.velocity = value
        trigger()
      },
    }
  })

  const resting = customRef((track, trigger) => {
    spring.onStart(trigger)
    spring.onStop(trigger)

    return {
      get() {
        track()
        return spring.resting
      },
      set() {},
    }
  })

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return {
    value,
    velocity,
    resting,
    jumpTo: (value: number) => {
      spring.jumpTo(value)
    },
  }
}
