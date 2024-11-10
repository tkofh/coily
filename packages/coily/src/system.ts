import { Scheduler } from './scheduler'
import { Spring, type SpringOptions } from './spring'

class SpringSystemImpl implements SpringSystem {
  readonly #scheduler: Scheduler

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

export interface SpringSystem {
  createSpring(options: SpringOptions): Spring
  tick(dt: number): void
}

export function createSpringSystem(): SpringSystem {
  return new SpringSystemImpl()
}
