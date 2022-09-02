import type { SpringConfig, SpringOptions, StandaloneSpring } from './types'
import { createSpringImpl } from './lib'

export const createSpring = (
  initial: number,
  config: SpringConfig,
  options?: SpringOptions
): StandaloneSpring => {
  const [spring, simulate] = createSpringImpl(initial, config, options)

  return Object.assign(spring, { simulate })
}
