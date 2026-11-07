import { type App, type InjectionKey, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'
import { injectLocal, provideLocal } from './local.ts'

// Symbol.for, so two copies of coily in one app resolve the same key.
export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

/**
 * Provides a spring system that you create and manage yourself. Coily
 * never starts or stops it. With `app`, the system is provided to the
 * whole app, as the Nuxt module does. Without `app`, the call must run
 * in `setup()`, and the system is provided to the current component and
 * its descendants, including the component's own `useSpring` calls. It
 * is mostly useful in tests.
 */
export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provideLocal(SpringSystemKey, system)
  }
}

/**
 * Returns the spring system that this component or an ancestor provides,
 * and creates one when none exists. A created system is provided to this
 * component and its descendants. It starts when the component mounts and
 * is disposed before the component unmounts.
 *
 * You can call it near the root and again in any descendant. A call
 * below a provider returns the provided system instead of creating
 * another. `options` applies only when the call creates a system. The
 * call throws outside `setup()`.
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
