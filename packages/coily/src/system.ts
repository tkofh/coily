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

  advance(dt: number) {
    this.#ticker.advance(dt)
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
  /** Advance all springs by `dt` milliseconds, without affecting internal timing. */
  advance(dt: number): void

  /** Start the animation loop. */
  start(): void
  /** Stop the animation loop. */
  stop(): void
  /** Whether the animation loop is currently running. */
  readonly running: boolean

  /**
   * The target frames per second for the simulation loop.
   *
   * must be greater than 0
   */
  fps: number
  /**
   * The maximum elapsed time (in ms) before a frame is considered a lag spike
   * (e.g. from a backgrounded tab). When exceeded, `adjustedLag` is used instead
   * of the real elapsed time. Set to 0 to disable lag detection.
   *
   * must be greater than or equal to 0
   */
  lagThreshold: number
  /**
   * The substitute elapsed time (in ms) used when a lag spike is detected.
   * Clamped to be at most `lagThreshold`.
   *
   * must be greater than or equal to 0
   */
  adjustedLag: number
}

export function createSpringSystem(options?: TickerOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
