import { computed, inject, isRef, onBeforeUnmount, ref, watch } from 'vue'
import type { SpringConfig, SpringState } from 'coily'
import { SPRING_SYSTEM } from './injections'
import type {
  Reactable,
  ReactableResult,
  SpringEventHook,
  SpringOptions,
  UseSpringReturn,
} from './types'
import { paramToRef } from './util'

export const useSpring = <
  TTarget extends Reactable<number>,
  TConfig extends Reactable<SpringConfig>,
  TOptions extends SpringOptions | undefined
>(
  initial: TTarget,
  config: TConfig,
  options?: TOptions
): UseSpringReturn<TTarget, TConfig, TOptions> => {
  const system = inject(SPRING_SYSTEM)

  if (!system) {
    throw new Error('useSpring called before useSpringSystem.')
  }

  const target = paramToRef(initial)
  const configRef = paramToRef(config)

  const spring = system.createSpring(target.value, configRef.value, options)

  onBeforeUnmount(() => {
    system.cleanup(spring)
  })

  watch(
    target,
    (target) => {
      spring.target = target
    },
    { flush: 'sync' }
  )

  watch(
    configRef,
    (config) => {
      spring.config = config
    },
    { flush: 'sync' }
  )

  const current = ref(spring.value)
  const velocity = ref(spring.velocity)
  spring.on('update:value', (value) => {
    current.value = value
    velocity.value = spring.velocity
  })

  const state = ref(spring.state)
  spring.on('update:state', (value) => {
    state.value = value
  })

  const frozen = paramToRef(options?.frozen ?? false)

  watch(
    frozen,
    (frozen) => {
      if (frozen) {
        spring.freeze()
      } else {
        spring.unfreeze()
      }
    },
    { flush: 'sync' }
  )

  const onValueChange: SpringEventHook<number> = (handler) => {
    spring.on('update:value', handler)
    return () => spring.off('update:value', handler)
  }

  const onStateChange: SpringEventHook<SpringState> = (handler) => {
    spring.on('update:state', handler)
    return () => spring.off('update:state', handler)
  }

  return {
    current: computed(() => current.value),
    state: computed(() => state.value),
    velocity: computed(() => velocity.value),
    config: (isRef(config) ? config : configRef) as ReactableResult<TConfig, SpringConfig>,
    target: (isRef(initial) ? initial : target) as ReactableResult<TTarget, number>,
    frozen: frozen as ReactableResult<
      TOptions extends SpringOptions ? TOptions['frozen'] : boolean,
      boolean
    >,
    onValueChange,
    onStateChange,
  }
}
