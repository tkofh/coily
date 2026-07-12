import { onScopeDispose } from 'vue'
import type { SpringConfig } from '../config.ts'
import type { ConfigShape, Shape, SpringObject } from '../spring-object.ts'
import type { Spring } from '../spring.ts'
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
   * Creates a pooled spring at rest at `value`. Without `config`, the
   * default applies.
   */
  createSpring(value: number, config?: SpringConfig): Spring
  /**
   * Creates a pooled composite spring over a numeric shape whose leaves
   * are all numbers. `config` applies per channel: one `SpringConfig`
   * for all, or a shape with configs at any level.
   */
  createSpring<T extends object>(value: T & Shape<T>, config?: ConfigShape<T>): SpringObject<T>
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

  // Cast recovers the overload pair: no single implementation signature
  // can satisfy both, since SpringObject's type parameter is invariant.
  const createSpring = ((
    value: number | Record<string, number>,
    config?: SpringConfig | ConfigShape<Record<string, number>>,
  ) =>
    typeof value === 'number'
      ? adopt(system.createSpring(value, config as SpringConfig | undefined))
      : adopt(
          system.createSpring(value, config as ConfigShape<Record<string, number>> | undefined),
        )) as SpringPool['createSpring']

  return { createSpring }
}
