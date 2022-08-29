import type { SpringSystem } from 'coiled'
import { provide } from 'vue'
import { SPRING_SYSTEM } from './injections'

export const provideSpringSystem = (system: SpringSystem): void => {
  provide(SPRING_SYSTEM, system)
}
