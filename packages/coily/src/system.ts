import { Scheduler } from './scheduler'
import { Spring } from './spring'

interface SpringOptions {
  mass: number
  tension: number
  damping: number
  target?: number
  value?: number
  precision?: number
}

export class SpringSystem {
  #scheduler: Scheduler

  constructor() {
    this.#scheduler = new Scheduler()
  }

  createSpring(options: SpringOptions) {
    return new Spring(this.#scheduler, {
      ...options,
      target: options.target ?? 0,
    })
  }

  tick(dt: number) {
    this.#scheduler.tick(dt)
  }
}
