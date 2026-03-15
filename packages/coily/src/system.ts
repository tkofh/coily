import { Spring, type SpringOptions } from './spring.ts'
import { Ticker, type TickerOptions } from './ticker.ts'

class SpringSystemImpl implements SpringSystem {
  readonly #ticker: Ticker

  constructor(options?: TickerOptions) {
    this.#ticker = new Ticker(options)
  }

  createSpring(options: SpringOptions) {
    return new Spring(this.#ticker, options)
  }

  tick(dt: number) {
    this.#ticker.step(dt)
  }

  start() {
    this.#ticker.start()
  }

  stop() {
    this.#ticker.stop()
  }

  get running() {
    return !this.#ticker.stopped
  }

  get fps() {
    return this.#ticker.fps
  }

  set fps(value: number) {
    this.#ticker.fps = value
  }

  get lagThreshold() {
    return this.#ticker.lagThreshold
  }

  set lagThreshold(value: number) {
    this.#ticker.lagThreshold = value
  }

  get adjustedLag() {
    return this.#ticker.adjustedLag
  }

  set adjustedLag(value: number) {
    this.#ticker.adjustedLag = value
  }
}

export interface SpringSystem {
  createSpring(options: SpringOptions): Spring
  tick(dt: number): void

  start(): void
  stop(): void
  readonly running: boolean

  fps: number
  lagThreshold: number
  adjustedLag: number
}

export function createSpringSystem(options?: TickerOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
