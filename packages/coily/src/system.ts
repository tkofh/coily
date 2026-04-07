import type { SpringConfig } from './config.ts'
import { MotionSet } from './motion-set.ts'
import { Spring, type SpringPosition } from './spring.ts'
import { Spring2D, type Spring2DPosition } from './spring2d.ts'
import { Ticker, type TickerOptions } from './ticker.ts'

export interface SpringSystemOptions extends TickerOptions {
  debug?: boolean | undefined
}

class SpringSystemImpl implements SpringSystem {
  readonly #motion: MotionSet
  readonly #ticker: Ticker

  constructor(options?: SpringSystemOptions) {
    this.#motion = new MotionSet(options?.debug)
    this.#ticker = new Ticker(this.#motion, options)
  }

  createSpring(position: SpringPosition, config?: SpringConfig): Spring {
    return new Spring(this.#motion, position, config)
  }

  createSpring2D(position: Spring2DPosition, config?: SpringConfig): Spring2D {
    return new Spring2D(this.#motion, position, config)
  }

  advance(dt: number) {
    this.#motion.tick(dt / 1000)
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
  createSpring(position: SpringPosition, config?: SpringConfig): Spring
  createSpring2D(position: Spring2DPosition, config?: SpringConfig): Spring2D
  /** Advance all springs by `dt` milliseconds, without affecting internal timing. */
  advance(dt: number): void

  /** Start the animation loop. */
  start(): void
  /** Stop the animation loop. */
  stop(): void
  /** Whether the animation loop is currently running. */
  readonly running: boolean

  fps: number
  lagThreshold: number
  adjustedLag: number
}

export function createSpringSystem(options?: SpringSystemOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
