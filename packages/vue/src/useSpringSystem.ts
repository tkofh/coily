import type { SpringSystem } from 'coiled'
import { createSpringSystem } from 'coiled'
import { provide } from 'vue'
import { SPRING_SYSTEM } from './injection'

export const useSpringSystem = (): SpringSystem => {
  const system = createSpringSystem()

  provide(SPRING_SYSTEM, system)

  return system
}
