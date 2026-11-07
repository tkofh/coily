import { onScopeDispose } from 'vue'
import type { SpringDefinition } from '../config.ts'
import type { ConfigShape, Shape, CompositeSpring } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import type { SpringSource } from '../spring-source.ts'
import { injectSpringSystem } from './reactive-spring.ts'

/**
 * Imperative spring factories bound to the provided system, for springs
 * you create and dispose at any time, such as particles or per-item
 * effects. When the creating scope stops, the pool disposes every pooled
 * spring still alive. You can dispose one yourself before then.
 */
export interface SpringPool {
  /**
   * Creates a pooled spring at rest at `value`. Without `config`, the
   * spring uses the default config. `options.purpose` sets reduced-motion
   * behavior: a `'nonmotion'` spring keeps animating, and a `'motion'`
   * spring, the default, snaps.
   */
  createSpring(value: number, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a pooled spring already following `source`, starting at its
   * current value. `options.purpose` sets reduced-motion behavior.
   */
  createSpring(source: SpringSource, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a pooled composite spring over a shape whose leaves are all
   * numbers. `config` applies per channel: one `SpringDefinition` for all
   * channels, or a shape with configs at any level. `options.purpose` sets
   * reduced-motion behavior per channel in the same way.
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
 * Returns spring factories bound to the provided spring system. When
 * the current effect scope stops, the pool disposes every pooled spring
 * still alive.
 *
 * Call it during `setup()` or inside an effect scope, below a provided
 * spring system. It throws without one. Outside a scope, you must
 * dispose each pooled spring yourself.
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

  // `system.createSpring` dispatches on the value at runtime, so every
  // overload forwards through one widened signature. It is bound because
  // it reads `this`, and the outer cast restores the overloads.
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
