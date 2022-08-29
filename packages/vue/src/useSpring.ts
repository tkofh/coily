import { computed, inject, onScopeDispose, ref, watch } from 'vue'
import type { SpringConfig, SpringOptions } from 'coiled'
import { SPRING_SYSTEM } from './injections'
import type { UseSpringReturn } from './types'

export const useSpring = (
  initial: number,
  config: SpringConfig,
  options?: SpringOptions
): UseSpringReturn => {
  const system = inject(SPRING_SYSTEM)

  if (!system) {
    throw new Error(
      'useSpring called before useSpringSystem. Please use useStandaloneSpring if you wish to not use a spring system'
    )
  }

  const spring = system.createSpring(initial, config, options)

  onScopeDispose(() => {
    system.cleanup(spring)
  })

  const target = ref(spring.target)

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

  return {
    target,
    current: computed(() => current.value),
    state: computed(() => state.value),
    velocity: computed(() => velocity.value),
    freeze: spring.freeze,
    unfreeze: spring.unfreeze,
  }
}
