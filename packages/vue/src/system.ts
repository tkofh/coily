import { type SpringSystem, createSpringSystem } from 'coily'
import { start } from 'coily/loop'
import { type App, onBeforeUnmount, onMounted, provide } from 'vue'
import { SpringSystemKey } from './injection'

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
    stop = start(system as never)
  })

  onBeforeUnmount(stop)
}
