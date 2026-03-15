import { type App, type InjectionKey, onBeforeUnmount, onMounted, provide } from 'vue'
import { type SpringSystem, createSpringSystem } from '../system.ts'
import { start } from '../loop.ts'

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

  let stop: (() => void) | undefined

  onMounted(() => {
    stop = start(system)
  })

  onBeforeUnmount(() => stop?.())
}
