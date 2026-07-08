import { onScopeDispose } from 'vue'
import type { SpringConfig } from '../config.ts'
import type { Spring, SpringPosition } from '../spring.ts'
import type { Spring2D, Spring2DPosition } from '../spring2d.ts'
import { injectSpringSystem } from './reactive-spring.ts'

export interface SpringPool {
  createSpring(position: SpringPosition, config?: SpringConfig): Spring
  createSpring2D(position: Spring2DPosition, config?: SpringConfig): Spring2D
}

/**
 * Imperative spring creation tied to the current effect scope: springs made
 * through the pool are created on the provided spring system and disposed
 * automatically when the scope is torn down, so a dynamic set of springs
 * (particles, per-item effects) cannot leak motions. Disposing a spring
 * early is fine — it unregisters itself from the pool.
 */
export function useSpringPool(): SpringPool {
  const system = injectSpringSystem()
  const live = new Set<Spring | Spring2D>()

  const adopt = <T extends Spring | Spring2D>(spring: T): T => {
    live.add(spring)
    spring.onDispose(() => {
      live.delete(spring)
    })
    return spring
  }

  onScopeDispose(() => {
    for (const spring of live) {
      spring.dispose()
    }
  }, true)

  return {
    createSpring: (position, config) => adopt(system.createSpring(position, config)),
    createSpring2D: (position, config) => adopt(system.createSpring2D(position, config)),
  }
}
