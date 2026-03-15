import { createTicker } from './ticker'
import type { SpringSystem } from './index'

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
