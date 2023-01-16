import type { SpringChainLinkGetter, SpringConfig, SpringState } from 'coily'
import { computed, customRef, inject, isRef, onBeforeUnmount, watch } from 'vue'
import type { Reactable, ReactableResult, SpringOptions, UseSpringChainReturn } from './types'
import { SPRING_SYSTEM } from './injections'
import { paramToRef } from './util'

export const useSpringChain = <
  TTarget extends Reactable<number>,
  TLinks extends Reactable<SpringChainLinkGetter[]>,
  TConfig extends Reactable<SpringConfig>,
  TOptions extends SpringOptions | undefined
>(
  initial: TTarget,
  links: TLinks,
  config: TConfig,
  options?: TOptions
): UseSpringChainReturn<TTarget, TLinks, TConfig, TOptions> => {
  const system = inject(SPRING_SYSTEM)

  if (!system) {
    throw new Error('useSpringChain called before useSpringSystem.')
  }

  const target = paramToRef(initial)
  const linksRef = paramToRef(links)
  const configRef = paramToRef(config)

  const chain = system.createSpringChain(target.value, linksRef.value, configRef.value, options)

  onBeforeUnmount(() => {
    system.cleanup(chain)
  })

  watch(
    target,
    (target) => {
      chain.target = target
    },
    { flush: 'sync' }
  )

  watch(
    linksRef,
    (links) => {
      chain.links = links
    },
    { flush: 'sync' }
  )

  watch(
    configRef,
    (config) => {
      chain.config = config
    },
    { flush: 'sync' }
  )

  let updateCurrent: () => void
  let updateVelocities: () => void
  let updateTargets: () => void
  const current = customRef<ReadonlyArray<number>>((track, trigger) => {
    updateCurrent = trigger
    return {
      get: () => {
        track()
        return chain.values
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set: (_) => {},
    }
  })
  const velocities = customRef<ReadonlyArray<number>>((track, trigger) => {
    updateVelocities = trigger
    return {
      get: () => {
        track()
        return chain.velocities
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set: (_) => {},
    }
  })
  const targets = customRef<ReadonlyArray<number>>((track, trigger) => {
    updateTargets = trigger
    return {
      get: () => {
        track()
        return chain.targets
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set: (_) => {},
    }
  })

  chain.on('update:value', () => {
    updateCurrent()
    updateVelocities()
    updateTargets()
  })

  let updateState: () => void
  let updateStates: () => void
  const state = customRef<SpringState>((track, trigger) => {
    updateState = trigger
    return {
      get: () => {
        track()
        return chain.state
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set: (_) => {},
    }
  })
  const states = customRef<ReadonlyArray<SpringState>>((track, trigger) => {
    updateStates = trigger
    return {
      get: () => {
        track()
        return chain.states
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      set: (_) => {},
    }
  })

  chain.on('update:value', () => {
    updateState()
    updateStates()
  })

  const frozen = paramToRef(options?.frozen ?? false)

  watch(
    frozen,
    (frozen) => {
      if (frozen) {
        chain.freeze()
      } else {
        chain.unfreeze()
      }
    },
    { flush: 'sync' }
  )

  return {
    state: computed(() => state.value),
    states: computed(() => states.value),
    current: computed(() => current.value),
    velocities: computed(() => velocities.value),
    config: (isRef(config) ? config : configRef) as ReactableResult<TConfig, SpringConfig>,
    target: (isRef(initial) ? initial : target) as ReactableResult<TTarget, number>,
    targets: computed(() => targets.value),
    links: (isRef(links) ? links : linksRef) as ReactableResult<
      TLinks,
      SpringChainLinkGetter[],
      ReadonlyArray<SpringChainLinkGetter>
    >,
    frozen: frozen as ReactableResult<
      TOptions extends SpringOptions ? TOptions['frozen'] : boolean,
      boolean
    >,
  }
}
