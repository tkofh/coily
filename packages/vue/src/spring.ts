import {
  type MaybeRefOrGetter,
  type Ref,
  inject,
  onBeforeUnmount,
  ref,
  toValue,
  watchEffect,
} from 'vue'
import { SpringSystemKey } from './injection'

interface SpringOptions {
  mass: number
  tension: number
  damping: number
  precision?: number
}

interface UseSpringReturn {
  readonly value: Readonly<Ref<number>>
  readonly velocity: Readonly<Ref<number>>
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

  watchEffect(() => {
    spring.target = toValue(target)
  })

  watchEffect(() => {
    const opts = toValue(options)
    if (opts) {
      spring.mass = opts.mass
      spring.tension = opts.tension
      spring.damping = opts.damping
    }
  })

  const value = ref(spring.value)
  const velocity = ref(spring.velocity)
  const resting = ref(spring.resting)

  const stop = spring.onUpdate(() => {
    value.value = spring.value
    velocity.value = spring.velocity
    resting.value = spring.resting
  })

  onBeforeUnmount(stop)

  return {
    value,
    velocity,
    resting,
  }
}
