import type { SpringDefinition } from './config.ts'
import { MotionSet } from './motion-set.ts'
import { Spring, type Purpose } from './spring.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from './spring-source.ts'
import {
  type ConfigShape,
  type PurposeShape,
  type Shape,
  CompositeSpring,
} from './composite-spring.ts'
import { Ramp, type RampOptions } from './ramp.ts'
import { Ticker, type TickerOptions } from './ticker.ts'
import { invariant } from './util.ts'

/**
 * Per-spring options for `SpringSystem.createSpring`, separate from the
 * physical `config`.
 */
export interface SpringOptions {
  /**
   * What the spring animates, which decides whether reduced motion applies
   * to it. `'nonmotion'` — a cross-fade, a color, a blur — keeps
   * animating under reduced motion; `'motion'` snaps to the target. Fixed
   * for the spring's life. See `Purpose`.
   * @default 'motion'
   */
  purpose?: Purpose | undefined
}

/**
 * Per-spring options for a composite `SpringSystem.createSpring`, separate
 * from the physical `config`.
 */
export interface CompositeSpringOptions<T extends object> {
  /**
   * What each channel animates, deciding reduced-motion behavior per
   * channel: a single `Purpose` for every channel, or a shape mirroring
   * the value with purposes at any level — a purpose at a subtree covers
   * every channel below it. Channels it doesn't reach default to
   * `'motion'`. Fixed for the spring's life. See `PurposeShape`.
   * @default 'motion'
   */
  purpose?: PurposeShape<T> | undefined
}

export interface SpringSystemOptions extends TickerOptions {
  /**
   * How far a spring may trail a source it follows within one frame, in
   * the value's own units. A frame whose motion would exceed it is split
   * into internal sub-steps (at most 8), so followed chains stay
   * accurate through slow frames and sudden retargets. Smaller is
   * tighter and costs more solver work; it never goes finer than the
   * follower's resting precision, and listeners still fire once per
   * frame. Springs that follow nothing are unaffected.
   * @default 0.1
   */
  couplingTolerance?: number | undefined
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
  readonly #motions: MotionSet
  readonly #ticker: Ticker

  constructor(options?: SpringSystemOptions) {
    this.#motions = new MotionSet(options?.debug)
    this.#ticker = new Ticker(this.#motions, options)

    if (options?.couplingTolerance !== undefined) {
      this.couplingTolerance = options.couplingTolerance
    }

    const mode = options?.reducedMotion ?? 'user'
    if (mode === 'always') {
      this.#motions.reduced = true
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
    this.#motions.setReduced(reduced)
  }

  get reducedMotion() {
    return this.#motions.reduced
  }

  get couplingTolerance() {
    return this.#motions.couplingTolerance
  }

  set couplingTolerance(value: number) {
    invariant(
      Number.isFinite(value) && value >= 0,
      'couplingTolerance must be a finite, non-negative number',
    )
    this.#motions.couplingTolerance = value
  }

  createSpring(value: number, config?: SpringDefinition, options?: SpringOptions): Spring
  createSpring(source: SpringSource, config?: SpringDefinition, options?: SpringOptions): Spring
  createSpring<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
    options?: CompositeSpringOptions<T>,
  ): CompositeSpring<T>
  createSpring(
    value: number | SpringSource | Record<string, number>,
    config?: SpringDefinition | ConfigShape<Record<string, number>>,
    options?: SpringOptions | CompositeSpringOptions<Record<string, number>>,
  ): Spring | CompositeSpring<Record<string, number>> {
    if (typeof value === 'number') {
      return new Spring(
        this.#motions,
        value,
        config as SpringDefinition | undefined,
        (options as SpringOptions | undefined)?.purpose,
      )
    }
    if (isSpringSource(value)) {
      const api = value[SpringSourceSymbol]
      invariant(
        typeof api.value === 'number',
        'A spring can only follow a scalar SpringSource; derive one from a composite with mapSpring',
      )
      const spring = new Spring(
        this.#motions,
        api.value,
        config as SpringDefinition | undefined,
        (options as SpringOptions | undefined)?.purpose,
      )
      spring.target = value as SpringSource
      return spring
    }
    return new CompositeSpring(
      this.#motions,
      value,
      config as ConfigShape<Record<string, number>> | undefined,
      (options as CompositeSpringOptions<Record<string, number>> | undefined)?.purpose,
    )
  }

  createRamp(from: number, options: RampOptions): Ramp {
    return new Ramp(this.#motions, from, options)
  }

  advance(dt: number) {
    invariant(Number.isFinite(dt), 'dt must be a finite number of milliseconds')
    this.#motions.tick(dt / 1000)
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
   *
   * `options.purpose` marks what the spring animates: `'nonmotion'`
   * keeps animating under reduced motion, `'motion'` (the default) snaps.
   */
  createSpring(value: number, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a spring already following `source` — a `Spring`, or a value
   * derived with `mapSpring`. It starts at the source's current value,
   * so nothing moves until the source does; equivalent to creating a
   * spring at that value and assigning `source` to its `target`.
   *
   * `options.purpose` marks what the spring animates: `'nonmotion'`
   * keeps animating under reduced motion, `'motion'` (the default) snaps.
   */
  createSpring(source: SpringSource, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a composite spring over a numeric shape: a plain object or
   * array, nested arbitrarily, whose leaves are all numbers. Each leaf
   * becomes an independently sprung channel.
   *
   * `config` applies per channel: a single `SpringDefinition` for every
   * channel, or a shape mirroring the value with configs at any level.
   * `options.purpose` marks reduced-motion behavior the same way, per
   * channel — a `'nonmotion'` channel keeps animating.
   */
  createSpring<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
    options?: CompositeSpringOptions<T>,
  ): CompositeSpring<T>
  /**
   * Creates a ramp at `from`: a value that moves toward `options.target`
   * at `options.rate` value units per second, in a straight line, and
   * stops there. A spring that follows a ramp tracks its steady motion
   * exactly. Without a target the ramp starts at rest; `Infinity` or
   * `-Infinity` makes it endless.
   *
   * ```ts
   * // An endless spin at 270 deg/s, with a spring lagging behind it.
   * const sweep = system.createRamp(0, { rate: 270, target: Infinity })
   * const ring = system.createSpring(sweep)
   *
   * // A clock: 0 to 600 over 600 ms, mapped into a pulse.
   * const clock = system.createRamp(0, { rate: 1000, target: 600 })
   * const pulse = system.createSpring(mapSpring(clock, (ms) => Math.sin((Math.PI * ms) / 600)))
   * ```
   *
   * `options.purpose` marks what the ramp drives: a `'motion'` ramp (the
   * default) jumps to a bounded target under reduced motion and holds
   * still on an endless one, and a `'nonmotion'` ramp keeps moving.
   */
  createRamp(from: number, options: RampOptions): Ramp
  /**
   * Advances every moving spring and ramp by `dt` milliseconds. For
   * manual stepping in place of `start()` — tests, custom loops, offline
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
   * Read it to gate purely decorative effects of your own. Springs
   * created with `purpose: 'nonmotion'` animate regardless.
   */
  readonly reducedMotion: boolean
  /**
   * How far a spring may trail a source it follows within one frame, in
   * the value's own units — see the `couplingTolerance` option.
   * Assignment accepts any finite number >= 0 and applies from the next
   * frame; 0 means as fine as the follower's resting precision allows.
   */
  couplingTolerance: number
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
