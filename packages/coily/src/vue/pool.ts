import { onScopeDispose } from 'vue'
import type { SpringDefinition } from '../config.ts'
import type { ConfigShape, Shape, CompositeSpring } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import type { SpringSource } from '../spring-source.ts'
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
   * default applies. `options.purpose` sets reduced-motion behavior —
   * `'appearance'` keeps animating, `'motion'` (default) snaps.
   */
  createSpring(value: number, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a pooled spring already following `source`, starting at its
   * current value. `options.purpose` sets reduced-motion behavior.
   */
  createSpring(source: SpringSource, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a pooled composite spring over a numeric shape whose leaves
   * are all numbers. `config` applies per channel: one `SpringDefinition`
   * for all, or a shape with configs at any level. `options.purpose` sets
   * reduced-motion behavior per channel the same way.
   */
  createSpring<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
    options?: CompositeSpringOptions<T>,
  ): CompositeSpring<T>
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

  // The pool mirrors the system's `createSpring` overloads but only wires
  // the result to the scope's disposer, so every overload would forward
  // the same args to the same call. `system.createSpring` already
  // dispatches on the value at runtime, so call it through one widened
  // signature (bound, since it reads `this`) and let the outer cast
  // restore the overloads for callers.
  const create = (
    system.createSpring as (
      value: number | SpringSource | Record<string, number>,
      config?: SpringDefinition | ConfigShape<Record<string, number>>,
      options?: SpringOptions | CompositeSpringOptions<Record<string, number>>,
    ) => Spring | CompositeSpring<Record<string, number>>
  ).bind(system)

  const createSpring = ((
    value: number | SpringSource | Record<string, number>,
    config?: SpringDefinition | ConfigShape<Record<string, number>>,
    options?: SpringOptions | CompositeSpringOptions<Record<string, number>>,
  ) => adopt(create(value, config, options))) as SpringPool['createSpring']

  return { createSpring }
}
