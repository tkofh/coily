import { type SpringSystem, createSpringSystem } from 'coily'
import { start } from 'coily/loop'
import { onBeforeUnmount, onMounted, provide } from 'vue'
import { SpringSystemKey } from './injection'

export function provideSpringSystem(system: SpringSystem) {
  provide(SpringSystemKey, system)
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
