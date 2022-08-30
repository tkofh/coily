import { computed, inject, isRef, onBeforeUnmount, ref, watch } from 'vue'
import type { SpringConfig } from 'coiled'
import { SPRING_SYSTEM } from './injections'
import type { Reactable, SpringOptions, UseSpringReturn } from './types'
import { paramToRef } from './util'

export const useSpring = <
  TTarget extends Reactable<number>,
  TOptions extends SpringOptions | undefined
>(
  initial: TTarget,
  config: Reactable<SpringConfig>,
  options?: TOptions
): UseSpringReturn<TTarget, TOptions> => {
  const system = inject(SPRING_SYSTEM)

  if (!system) {
    throw new Error(
      'useSpring called before useSpringSystem. Please use useStandaloneSpring if you wish to not use a spring system'
    )
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

  const { frozen = undefined } = options ?? {}

  const result = {
    current: computed(() => current.value),
    state: computed(() => state.value),
    velocity: computed(() => velocity.value),
    config: computed(() => configRef.value),
    target: isRef(initial) ? initial : target,
  }

  if (frozen) {
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
  } else {
    ;(result as UseSpringReturn<TTarget, undefined>).freeze = spring.freeze
    ;(result as UseSpringReturn<TTarget, undefined>).unfreeze = spring.unfreeze
  }

  return result as UseSpringReturn<TTarget, TOptions>
}
