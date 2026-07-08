import type { SpringConfig } from './config.ts'
import { MotionSet } from './motion-set.ts'
import { Spring, type SpringPosition } from './spring.ts'
import { Spring2D, type Spring2DPosition } from './spring2d.ts'
import { Ticker, type TickerOptions } from './ticker.ts'

export interface SpringSystemOptions extends TickerOptions {
  debug?: boolean | undefined
  /**
   * How the system responds to the user's reduced-motion preference. When
   * active, springs snap to their targets instead of animating: retargets and
   * value writes apply instantly, velocity impulses are ignored, and springs
   * created displaced start at their target.
   *
   * - `'user'` — follow `prefers-reduced-motion` and react to live changes
   *   (inactive where `matchMedia` is unavailable, e.g. during SSR)
   * - `'always'` — reduced motion is always active
   * - `'never'` — reduced motion is never active
   *
   * @default 'user'
   */
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
      // Complete in-flight animations instantly rather than letting them play out
      this.#motion.finishAll()
    }
  }

  get reducedMotion() {
    return this.#motion.reduced
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
  /**
   * Whether reduced motion is currently active — see
   * `SpringSystemOptions.reducedMotion`. Useful for gating purely decorative
   * effects (particles, flourishes) in application code.
   */
  readonly reducedMotion: boolean

  fps: number
  lagThreshold: number
  adjustedLag: number
}

export function createSpringSystem(options?: SpringSystemOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
