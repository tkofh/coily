import { onScopeDispose } from 'vue'
import type { SpringConfig } from '../config.ts'
import type { ConfigShape, Shape, SpringObject } from '../spring-object.ts'
import type { Spring, SpringPosition } from '../spring.ts'
import { injectSpringSystem } from './reactive-spring.ts'

/**
 * Imperative spring factories bound to the provided system, for dynamic
 * sets of springs — particles, per-item effects — created and disposed
 * at arbitrary times. Any pooled spring still alive when the creating
 * scope tears down is disposed automatically; disposing one manually
 * before that is fine.
 */
export interface SpringPool {
  /**
   * Creates a pooled spring at `position` — a number for a spring at
   * rest, or a target/value pair for one created displaced or following
   * another spring. Without `config`, the default applies.
   */
  createSpring(position: SpringPosition, config?: SpringConfig): Spring
  /**
   * Creates a pooled composite spring over a numeric shape whose leaves
   * are all numbers. `config` applies per channel: one `SpringConfig`
   * for all, or a shape with configs at any level.
   */
  createSpringObject<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
  ): SpringObject<T>
}

interface PoolSpring {
  dispose(): void
  onDispose(callback: () => void): () => void
}

/**
 * Returns spring factories bound to the provided spring system, with
 * lifetimes tied to the current effect scope: every pooled spring still
 * alive at scope teardown is disposed, so leaked motions are
 * structurally impossible.
 *
 * Call it during `setup()` — or inside an effect scope — below a
 * provided spring system. Outside a scope, pooled springs are only
 * disposed manually.
 */
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
