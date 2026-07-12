import { onScopeDispose } from 'vue'
import type { SpringDefinition } from '../config.ts'
import type { ConfigShape, Shape, CompositeSpring } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import { type SpringSource, isSpringSource } from '../spring-source.ts'
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
  createSpring(value: number, config?: SpringDefinition): Spring
  /**
   * Creates a pooled spring already following `source`, starting at its
   * current value. Without a `config` of its own it adopts the source's.
   */
  createSpring(source: SpringSource, config?: SpringDefinition): Spring
  /**
   * Creates a pooled composite spring over a numeric shape whose leaves
   * are all numbers. `config` applies per channel: one `SpringDefinition`
   * for all, or a shape with configs at any level.
   */
  createSpring<T extends object>(value: T & Shape<T>, config?: ConfigShape<T>): CompositeSpring<T>
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

  // Cast recovers the overload set: no single implementation signature
  // can satisfy them all, since CompositeSpring's type parameter is
  // invariant.
  const createSpring = ((
    value: number | SpringSource | Record<string, number>,
    config?: SpringDefinition | ConfigShape<Record<string, number>>,
  ) =>
    typeof value === 'number'
      ? adopt(system.createSpring(value, config as SpringDefinition | undefined))
      : isSpringSource(value)
        ? adopt(system.createSpring(value as SpringSource, config as SpringDefinition | undefined))
        : adopt(
            system.createSpring(value, config as ConfigShape<Record<string, number>> | undefined),
          )) as SpringPool['createSpring']

  return { createSpring }
}
