import { Ticker } from './ticker.ts'
import type { SpringSystem } from './system.ts'

export function start(system: SpringSystem) {
  const ticker = new Ticker()

  ticker.add((_, delta) => {
    system.tick(delta / 1000)
  })
  ticker.start()

  return () => {
    ticker.stop()
  }
}
