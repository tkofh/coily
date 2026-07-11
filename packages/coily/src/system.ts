import type { SpringConfig } from './config.ts'
import { MotionSet } from './motion-set.ts'
import { Spring, type SpringPosition } from './spring.ts'
import { type ConfigShape, type Shape, SpringObject } from './spring-object.ts'
import { Ticker, type TickerOptions } from './ticker.ts'

export interface SpringSystemOptions extends TickerOptions {
  debug?: boolean | undefined
  reducedMotion?: 'user' | 'always' | 'never' | undefined
}

class SpringSystemImpl implements SpringSystem {
  readonly #motion: MotionSet
  readonly #ticker: Ticker

  constructor(options?: SpringSystemOptions) {
    this.#motion = new MotionSet(options?.debug)
    this.#ticker = new Ticker(this.#motion, options)

    const mode = options?.reducedMotion ?? 'user'
    if (mode === 'always') {
      this.#motion.reduced = true
    } else if (
      mode === 'user' &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)')
      this.#applyReducedMotion(query.matches)
      query.addEventListener('change', (event) => {
        this.#applyReducedMotion(event.matches)
      })
    }
  }

  #applyReducedMotion(reduced: boolean) {
    this.#motion.reduced = reduced
    if (reduced) {
      this.#motion.finishAll()
    }
  }

  get reducedMotion() {
    return this.#motion.reduced
  }

  createSpring(position: SpringPosition, config?: SpringConfig): Spring {
    return new Spring(this.#motion, position, config)
  }

  createSpringObject<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
  ): SpringObject<T> {
    return new SpringObject(this.#motion, value, config)
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
  createSpringObject<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
  ): SpringObject<T>
  advance(dt: number): void

  start(): void
  stop(): void
  readonly running: boolean
  readonly reducedMotion: boolean
  fps: number
  lagThreshold: number
  adjustedLag: number
}

export function createSpringSystem(options?: SpringSystemOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
