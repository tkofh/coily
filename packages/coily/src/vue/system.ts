import { type App, type InjectionKey, onBeforeUnmount, onMounted, provide } from 'vue'
import { type SpringSystem, createSpringSystem } from '../index'
import { start } from '../loop'

export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provide(SpringSystemKey, system)
  }
}

export function useSpringSystem() {
  const system = createSpringSystem()

  provideSpringSystem(system)

  let stop!: () => void

  onMounted(() => {
    stop = start(system)
  })

  onBeforeUnmount(stop)
}
