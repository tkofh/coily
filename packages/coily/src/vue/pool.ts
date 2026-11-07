import { onScopeDispose } from 'vue'
import type { SpringDefinition } from '../config.ts'
import type { ConfigShape, Shape, CompositeSpring } from '../composite-spring.ts'
import type { Spring } from '../spring.ts'
import type { SpringOptions, CompositeSpringOptions } from '../system.ts'
import type { SpringSource } from '../spring-source.ts'
import { injectSpringSystem } from './reactive-spring.ts'

/**
 * Imperative spring factories bound to the provided system. Use them for
 * sets of springs that you create and dispose at any time, such as
 * particles or per-item effects. When the creating scope stops, the pool
 * disposes every pooled spring that is still alive. You can also dispose
 * a pooled spring yourself before then.
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
 * Returns spring factories bound to the provided spring system. The
 * current effect scope sets the lifetime of each pooled spring: when the
 * scope stops, the pool disposes every pooled spring that is still
 * alive.
 *
 * Call it during `setup()` or inside an effect scope, below a provided
 * spring system. Outside a scope, nothing disposes pooled springs for
 * you, and you must dispose each one yourself.
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

  // The pool mirrors the overloads of `system.createSpring` and only adds
  // each result to the scope's disposer, so every overload would forward
  // the same args to the same call. `system.createSpring` already
  // dispatches on the value at runtime. The pool calls it through one
  // widened signature, bound because it reads `this`, and the outer cast
  // restores the overloads for callers.
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
