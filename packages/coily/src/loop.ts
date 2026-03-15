import { createTicker } from './ticker.ts'
import type { SpringSystem } from './system.ts'

export function start(system: SpringSystem) {
  const ticker = createTicker()

  ticker.start()
  ticker.add((_, delta) => {
    system.tick(delta / 1000)
  })

  return () => {
    ticker.stop()
  }
}
