import { type App, type InjectionKey, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'
import { injectLocal, provideLocal } from './local.ts'

// Symbol.for, so duplicate copies of coily in one app resolve the same key.
export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

/**
 * Supplies a spring system you created and manage yourself — coily never
 * starts or stops it. With `app`, the system is installed app-wide
 * (what the Nuxt module does); without, it is provided to the current
 * component and its descendants, including this component's own
 * `useSpring` calls. Mostly useful in tests.
 */
export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provideLocal(SpringSystemKey, system)
  }
}

/**
 * Returns the spring system provided by this component or an ancestor,
 * creating one when none exists. A created system is provided to this
 * component and its descendants and started/stopped with the component's
 * mount lifecycle.
 *
 * Idempotent: call it near the root and again in any descendant.
 * `options` only applies when the call actually creates a system.
 * Throws outside `setup()`.
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
  onBeforeUnmount(() => system.stop())

  return system
}
