import type { SpringDefinition } from './config.ts'
import { MotionSet } from './motion-set.ts'
import { Spring } from './spring.ts'
import { type SpringSource, isSpringSource } from './spring-source.ts'
import { type ConfigShape, type Shape, CompositeSpring } from './composite-spring.ts'
import { Ticker, type TickerOptions } from './ticker.ts'
import { invariant } from './util.ts'

export interface SpringSystemOptions extends TickerOptions {
  /**
   * Log active motion counts to the console whenever they change.
   * @default false
   */
  debug?: boolean | undefined
  /**
   * When springs snap to their targets instead of animating. `'user'`
   * follows the OS prefers-reduced-motion setting, including live changes
   * — switching it on finishes in-flight motion instantly. `'always'` and
   * `'never'` force one behavior.
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
      this.#motion.finishAll()
    }
  }

  get reducedMotion() {
    return this.#motion.reduced
  }

  createSpring(value: number, config?: SpringDefinition): Spring
  createSpring(source: SpringSource, config?: SpringDefinition): Spring
  createSpring<T extends object>(value: T & Shape<T>, config?: ConfigShape<T>): CompositeSpring<T>
  createSpring(
    value: number | SpringSource | Record<string, number>,
    config?: SpringDefinition | ConfigShape<Record<string, number>>,
  ): Spring | CompositeSpring<Record<string, number>> {
    if (typeof value === 'number') {
      return new Spring(this.#motion, value, config as SpringDefinition | undefined)
    }
    if (isSpringSource(value)) {
      invariant(
        typeof value.value === 'number',
        'A spring can only follow a scalar SpringSource; derive one from a composite with mapSpring',
      )
      const spring = new Spring(this.#motion, value.value, config as SpringDefinition | undefined)
      spring.target = value as SpringSource
      return spring
    }
    return new CompositeSpring(
      this.#motion,
      value,
      config as ConfigShape<Record<string, number>> | undefined,
    )
  }

  advance(dt: number) {
    invariant(Number.isFinite(dt), 'dt must be a finite number of milliseconds')
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

/**
 * Owns springs and advances them over time. Create one with
 * `createSpringSystem`, then either `start()` it to animate on real
 * frames or call `advance` yourself for manual stepping.
 */
export interface SpringSystem {
  /**
   * Creates a spring at rest at `value`. Without `config`, springs use
   * the default: critically damped, settling in about 500ms. To follow
   * another spring from birth, pass it in place of `value`.
   */
  createSpring(value: number, config?: SpringDefinition): Spring
  /**
   * Creates a spring already following `source` — a `Spring`, or a value
   * derived with `mapSpring`. It starts at the source's current value,
   * so nothing moves until the source does; equivalent to creating a
   * spring at `source.value` and assigning `source` to its `target`.
   * Without a `config` of its own it adopts the source's.
   */
  createSpring(source: SpringSource, config?: SpringDefinition): Spring
  /**
   * Creates a composite spring over a numeric shape: a plain object or
   * array, nested arbitrarily, whose leaves are all numbers. Each leaf
   * becomes an independently sprung channel.
   *
   * `config` applies per channel: a single `SpringDefinition` for every
   * channel, or a shape mirroring the value with configs at any level.
   */
  createSpring<T extends object>(value: T & Shape<T>, config?: ConfigShape<T>): CompositeSpring<T>
  /**
   * Advances every moving spring by `dt` milliseconds. For manual
   * stepping in place of `start()` — tests, custom loops, offline
   * rendering.
   */
  advance(dt: number): void

  /**
   * Begins animating on real frames: one tick per displayed frame, via
   * `requestAnimationFrame` in the browser and a `setTimeout` fallback
   * elsewhere. An idle system sleeps — no frames are scheduled while
   * every spring rests.
   */
  start(): void
  /** Stops animating. Springs hold their state until `start` or `advance`. */
  stop(): void
  /**
   * Whether the system is between `start()` and `stop()`. Sleeping while
   * idle still counts as running.
   */
  readonly running: boolean
  /**
   * Whether springs currently snap instead of animating, per the
   * `reducedMotion` option and, in `'user'` mode, the live OS setting.
   * Read it to gate purely decorative effects of your own.
   */
  readonly reducedMotion: boolean
  /**
   * Frame-rate cap. 0 means uncapped: one tick per displayed frame,
   * whatever rate the screen runs at. Capped ticks land on whole display
   * frames and receive the true elapsed time.
   */
  fps: number
  /**
   * Frame gap in milliseconds above which the gap is treated as lag — a
   * backgrounded tab, a blocking task — and replaced with `adjustedLag`,
   * so springs don't teleport when frames resume. 0 disables lag
   * clamping.
   */
  lagThreshold: number
  /** The elapsed milliseconds a lagging frame is replaced with. Clamped to at most `lagThreshold`. */
  adjustedLag: number
}

/**
 * Creates a spring system: the entry point of the library.
 *
 * @example
 * ```ts
 * const system = createSpringSystem()
 * system.start()
 *
 * const spring = system.createSpring(0)
 * spring.onUpdate(() => {
 *   element.style.translate = `${spring.value}px 0`
 * })
 * spring.target = 300
 * ```
 */
export function createSpringSystem(options?: SpringSystemOptions): SpringSystem {
  return new SpringSystemImpl(options)
}
