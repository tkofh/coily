import {
  type MaybeRefOrGetter,
  type Ref,
  customRef,
  inject,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringSystemKey } from './injection'

interface SpringOptions {
  mass: number
  tension: number
  damping: number
  precision?: number
}

interface UseSpringReturn {
  readonly value: Ref<number>
  readonly velocity: Ref<number>
  readonly resting: Readonly<Ref<boolean>>
}

const defaultOptions: SpringOptions = {
  mass: 1,
  tension: 100,
  damping: 10,
  precision: 2,
}

export function useSpring(
  target: MaybeRefOrGetter<number>,
  options?: MaybeRefOrGetter<SpringOptions>,
): UseSpringReturn {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const spring = system.createSpring({
    ...defaultOptions,
    ...toValue(options),
    target: toValue(target),
  })

  const triggers = new Set<() => void>()

  watchSyncEffect(() => {
    const opts = toValue(options)
    if (opts) {
      spring.mass = opts.mass
      spring.tension = opts.tension
      spring.damping = opts.damping
    }
  })

  const value = customRef((track, trigger) => {
    spring.onUpdate(trigger)

    triggers.add(trigger)

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
    spring.onUpdate(trigger)

    triggers.add(trigger)

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

    triggers.add(trigger)

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
    for (const trigger of triggers) {
      trigger()
    }
  })

  return {
    value,
    velocity,
    resting,
  }
}
