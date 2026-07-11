import { type App, type InjectionKey, getCurrentInstance, onBeforeUnmount, onMounted } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'
import { injectLocal, provideLocal } from './local.ts'

export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provideLocal(SpringSystemKey, system)
  }
}

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
