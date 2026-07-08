import { type App, type InjectionKey, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'
import { injectLocal, provideLocal } from './local.ts'

/**
 * Internal injection key. Deliberately not part of the public API — access
 * the system through `useSpringSystem()`. `Symbol.for` keeps duplicated
 * module instances (HMR, double-installs) resolving to the same key.
 */
export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

/**
 * Plug an existing spring system into a Vue app (or the current component's
 * subtree when no `app` is given). Starting and stopping the system stays
 * the caller's responsibility. Most apps don't need this — the coily/nuxt
 * module or `useSpringSystem()` cover the common cases.
 */
export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provideLocal(SpringSystemKey, system)
  }
}

/**
 * Returns the component's spring system. If an ancestor (or this component)
 * provided one, that system is returned; otherwise a new system is created,
 * provided to this component and its descendants, and started/stopped with
 * the component lifecycle.
 *
 * Idempotent: repeated calls in the same component return the same system.
 * `options` only apply when a new system is actually created.
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
