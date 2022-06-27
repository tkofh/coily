import type { SimulateFn, Spring, SpringSystem } from './types'
import { createSpringImpl } from './lib'

export const createSystem = (): SpringSystem => {
  const springs: Map<Spring, SimulateFn> = new Map()

  return {
    createSpring: (initial, config, options) => {
      const [spring, simulate] = createSpringImpl(initial, config, options)
      springs.set(spring, simulate)

      return spring
    },
    cleanup: (spring) => {
      springs.delete(spring)
    },
    simulate: (delta) => {
      for (const simulate of springs.values()) {
        simulate(delta)
      }
    },
  }
}
