import { type App, type InjectionKey, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'
import { injectLocal, provideLocal } from './local.ts'

// Symbol.for, so two copies of coily in one app resolve the same key.
export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

/**
 * Provides a spring system you create and manage yourself. Coily never
 * starts or stops it. With `app`, the whole app gets it, as with the
 * Nuxt module. Without `app`, call it in `setup()`, and it reaches the
 * current component, including its own `useSpring` calls, and its
 * descendants. Mostly useful in tests.
 */
export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provideLocal(SpringSystemKey, system)
  }
}

/**
 * Returns the spring system this component or an ancestor provides, or
 * creates one. A created system is provided to this component and its
 * descendants, starts when the component mounts, and is disposed before
 * it unmounts.
 *
 * A call below a provider returns the provided system, and `options`
 * applies only when the call creates one. Throws outside `setup()`.
 */
export function useSpringSystem(options?: SpringSystemOptions): SpringSystem {
  if (!getCurrentInstance()) {
    throw new Error('useSpringSystem must be called inside setup()')
  }

  const existing = injectLocal(SpringSystemKey)
  if (existing) return existing

  const system = createSpringSystem(options)
  provideLocal(SpringSystemKey, system)

  onMounted(() => system.start())
  onBeforeUnmount(() => system.dispose())

  return system
}
