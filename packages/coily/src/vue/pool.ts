import { onScopeDispose } from 'vue'
import type { SpringConfig } from '../config.ts'
import type { ConfigShape, Shape, SpringObject } from '../spring-object.ts'
import type { Spring, SpringPosition } from '../spring.ts'
import { injectSpringSystem } from './reactive-spring.ts'

export interface SpringPool {
  createSpring(position: SpringPosition, config?: SpringConfig): Spring
  createSpringObject<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
  ): SpringObject<T>
}

interface PoolSpring {
  dispose(): void
  onDispose(callback: () => void): () => void
}

export function useSpringPool(): SpringPool {
  const system = injectSpringSystem()
  const live = new Set<PoolSpring>()

  const adopt = <T extends PoolSpring>(spring: T): T => {
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
    createSpringObject<T extends object>(value: T & Shape<T>, config?: ConfigShape<T>) {
      return adopt(system.createSpringObject<T>(value, config))
    },
  }
}
