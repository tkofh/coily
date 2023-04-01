import mitt from 'mitt'
import type { SimulateFn, Spring, SpringChain, SpringSystemEmitter, SpringSystem } from './types'
import { createSpringChainImpl, createSpringImpl } from './lib'
export const createSpringSystem = (): SpringSystem => {
  const springs: Map<Spring | SpringChain, SimulateFn> = new Map()

  const { emit, ...emitterApi }: SpringSystemEmitter = mitt()

  return {
    ...emitterApi,
    createSpring: (initial, config, options) => {
      const [spring, simulate] = createSpringImpl(initial, config, options)
      springs.set(spring, simulate)

      return spring
    },
    createSpringChain: (initial, links, config, options) => {
      const [chain, simulate] = createSpringChainImpl(initial, links, config, options)
      springs.set(chain, simulate)

      return chain
    },
    cleanup: (spring) => {
      springs.delete(spring)
      // @ts-expect-error off can accept a handler making it incompatible
      spring.off('*')
      // @ts-expect-error off can accept a handler making it incompatible
      spring.off('update:state')
      // @ts-expect-error off can accept a handler making it incompatible
      spring.off('update:value')
    },
    simulate: (delta) => {
      for (const simulate of springs.values()) {
        simulate(delta)
      }
      emit('simulate:after', delta)
    },
  }
}
