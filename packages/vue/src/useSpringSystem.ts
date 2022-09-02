import type { SpringSystem } from 'coily'
import { createSpringSystem } from 'coily'
import { provide } from 'vue'
import { SPRING_SYSTEM } from './injections'

export const useSpringSystem = (): SpringSystem => {
  const system = createSpringSystem()

  provide(SPRING_SYSTEM, system)

  return system
}
