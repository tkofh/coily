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
   * to it. A `'nonmotion'` spring, such as a cross-fade, a color, or a
   * blur, keeps animating under reduced motion. A `'motion'` spring snaps
   * to the target. Fixed for the spring's life. See `Purpose`.
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
   * What each channel animates, which decides reduced-motion behavior
   * per channel. Give a single `Purpose` for every channel, or a shape
   * that mirrors the value with purposes at any level. A purpose at a
   * subtree covers every channel below it. Channels it does not reach
   * default to `'motion'`. Fixed for the spring's life. See
   * `PurposeShape`.
   * @default 'motion'
   */
  purpose?: PurposeShape<T> | undefined
}

export interface SpringSystemOptions extends TickerOptions {
  /**
   * How far a spring can trail a source it follows within one frame, in
   * the value's own units. If a frame's motion would exceed it, the
   * system splits the frame into internal sub-steps (at most 8), so
   * followed chains stay accurate through slow frames and sudden
   * retargets. A smaller value is tighter and costs more solver work.
   * The budget never goes finer than the follower's resting precision,
   * and listeners still fire once per frame. Springs that follow nothing
   * are unaffected.
   * @default 0.1
   */
  couplingTolerance?: number | undefined
  /**
   * Logs the count of active motions to the console after each frame
   * where it changed.
   * @default false
   */
  debug?: boolean | undefined
  /**
   * When reduced motion applies, making `'motion'` springs and ramps
   * jump to their targets instead of animating. `'user'` follows the OS
   * prefers-reduced-motion setting, including live changes. Switching it
   * on finishes in-flight motion at once. `'always'` and `'never'` force
   * one behavior.
   * @default 'user'
   */
  reducedMotion?: 'user' | 'always' | 'never' | undefined
}

class SpringSystemImpl implements SpringSystem {
  readonly #motions: MotionSet
  readonly #ticker: Ticker
  /** Removes the reduced-motion media query listener, or null without one. */
  #unwatchReducedMotion: (() => void) | null = null
  #disposed = false

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
      const onChange = (event: MediaQueryListEvent) => {
        this.#applyReducedMotion(event.matches)
      }
      query.addEventListener('change', onChange)
      this.#unwatchReducedMotion = () => query.removeEventListener('change', onChange)
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
    invariant(!this.#disposed, 'Cannot start a disposed spring system')
    this.#ticker.start()
  }

  stop() {
    this.#ticker.stop()
  }

  get running() {
    return !this.#ticker.stopped
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#ticker.dispose()
    this.#unwatchReducedMotion?.()
    this.#unwatchReducedMotion = null
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
 * Owns springs and ramps and advances them over time. Create one with
 * `createSpringSystem`. Then either `start()` it to animate on real
 * frames, or call `advance` yourself for manual stepping.
 */
export interface SpringSystem {
  /**
   * Creates a spring at rest at `value`. Without `config`, the spring
   * uses the default: critically damped, settling in about 500 ms. To
   * follow a source from creation, pass it in place of `value`.
   *
   * `options.purpose` marks what the spring animates: `'nonmotion'`
   * keeps animating under reduced motion, `'motion'` (the default) snaps.
   */
  createSpring(value: number, config?: SpringDefinition, options?: SpringOptions): Spring
  /**
   * Creates a spring that already follows `source`, which can be any
   * scalar `SpringSource`: a `Spring`, a `Ramp`, or a value derived with
   * `mapSpring`, `velocityOf`, `accelerationOf`, or `targetOf`. Passing
   * a composite source throws. Derive a scalar from it with `mapSpring`
   * instead. The spring starts at the source's current value, so
   * nothing moves until the source does. This is the same as creating a
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
   * channel. A `'nonmotion'` channel keeps animating.
   */
  createSpring<T extends object>(
    value: T & Shape<T>,
    config?: ConfigShape<T>,
    options?: CompositeSpringOptions<T>,
  ): CompositeSpring<T>
  /**
   * Creates a ramp at `from`: a value that moves toward `options.target`
   * at `options.rate` value units per second, in a straight line, and
   * stops there. A spring that follows a ramp integrates against its
   * steady motion exactly, not against a per-frame staircase. Without a
   * target, the ramp starts at rest. `Infinity` or `-Infinity` makes it
   * endless.
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
   * Advances every moving spring and ramp by `dt` milliseconds. Use it
   * for manual stepping in place of `start()`: in tests, custom loops,
   * or offline rendering.
   */
  advance(dt: number): void

  /**
   * Begins animating on real frames: one tick per displayed frame, through
   * `requestAnimationFrame` in the browser and a `setTimeout` fallback
   * elsewhere. An idle system sleeps. It schedules no frames while every
   * spring rests and no ramp advances with the frame loop.
   */
  start(): void
  /** Stops animating. Springs and ramps hold their state until `start` or `advance`. */
  stop(): void
  /**
   * Whether the system is between `start()` and `stop()`. Sleeping while
   * idle still counts as running.
   */
  readonly running: boolean
  /**
   * Stops the system for good and removes its listeners on the page: the
   * visibility listener and, with `reducedMotion: 'user'`, the media
   * query listener. Each system adds both when it is created, so dispose
   * a system you no longer need. `useSpringSystem` disposes the system it
   * creates when its component unmounts. Calling it again is a no-op.
   *
   * After dispose, `start()` throws. `advance` still steps the springs
   * and ramps, and `reducedMotion` no longer follows the user setting.
   */
  dispose(): void
  /**
   * Whether reduced motion is on, per the `reducedMotion` option and, in
   * `'user'` mode, the live OS setting. While it is on, springs and
   * ramps with `purpose: 'motion'` jump instead of animating, and those
   * with `purpose: 'nonmotion'` animate as normal. Read it to gate
   * decorative effects of your own.
   */
  readonly reducedMotion: boolean
  /**
   * How far a spring can trail a source it follows within one frame, in
   * the value's own units. See the `couplingTolerance` option.
   * Assignment accepts any finite number >= 0 and applies from the next
   * frame. 0 means as fine as the follower's resting precision allows.
   */
  couplingTolerance: number
  /**
   * Frame-rate cap, in frames per second. 0 means uncapped: one tick per
   * displayed frame, whatever rate the screen runs at. Capped ticks land
   * on whole display frames and receive the true elapsed time.
   */
  fps: number
  /**
   * Frame gap, in ms, above which the system treats the gap as lag,
   * such as a backgrounded tab or a blocking task. It replaces a lagging
   * gap with `adjustedLag`, so springs do not teleport when frames
   * resume. 0 disables lag clamping.
   */
  lagThreshold: number
  /** The elapsed ms that replaces a lagging frame's gap. Clamped to at most `lagThreshold`. */
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
