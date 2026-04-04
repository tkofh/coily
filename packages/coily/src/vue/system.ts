import { type App, type InjectionKey, onBeforeUnmount, onMounted, provide } from 'vue'
import { type SpringSystem, type SpringSystemOptions, createSpringSystem } from '../system.ts'

export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for('coily/spring-system')

export function provideSpringSystem(system: SpringSystem, app?: App) {
  if (app) {
    app.provide(SpringSystemKey, system)
  } else {
    provide(SpringSystemKey, system)
  }
}

export function useSpringSystem(options?: SpringSystemOptions) {
  const system = createSpringSystem(options)

  provideSpringSystem(system)

  onMounted(() => {
    system.start()
  })

  onBeforeUnmount(() => {
    system.stop()
  })
}
