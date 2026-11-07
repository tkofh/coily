import { registerBacking } from './follow-graph.ts'
import type { TargetedSource, TargetedSourceApi } from './kinematic-source.ts'
import type { MotionSet } from './motion-set.ts'
import { RampMotion } from './ramp-motion.ts'
import type { Purpose } from './spring.ts'
import { SpringSourceSymbol } from './spring-source.ts'
import { invariant, RESOLVED } from './util.ts'

/** Options for `SpringSystem.createRamp`. */
export interface RampOptions {
  /**
   * The ramp's speed, in value units per second. Must be finite and
   * >= 0. A rate of 0 rests the ramp where it is.
   */
  rate: number
  /**
   * Where the ramp heads. `Infinity` or `-Infinity` makes it endless in
   * that direction.
   * @default the starting value, so the ramp starts at rest
   */
  target?: number | undefined
  /**
   * What the ramp drives, which decides whether reduced motion applies.
   * Under reduced motion, a `'motion'` ramp jumps to a bounded target and
   * holds still on an endless one. A `'nonmotion'` ramp, such as a clock
   * for logic, keeps moving. Fixed for the ramp's life. See `Purpose`.
   * @default 'motion'
   */
  purpose?: Purpose | undefined
}

function assertRate(rate: number): void {
  invariant(Number.isFinite(rate) && rate >= 0, 'Ramp rate must be a finite number >= 0')
}

function assertTarget(target: number): void {
  invariant(
    typeof target === 'number' && !Number.isNaN(target),
    'Ramp target must be a number; use Infinity or -Infinity for an endless ramp',
  )
}

function assertValue(value: number): void {
  invariant(Number.isFinite(value), 'Ramp value must be a finite number')
}

/**
 * A value that moves toward its target at a fixed speed, in a straight
 * line, and stops there. Create ramps with `SpringSystem.createRamp`.
 *
 * A ramp is a `SpringSource`, so a spring can follow it. With the
 * default `arrival`, the spring integrates against the ramp's steady
 * motion exactly, where a target assigned once per frame would reach it
 * as a staircase. With any other `arrival`, the spring holds the target
 * still within each of a frame's sub-steps, one stair per sub-step.
 * Typical uses are an endless spin, a heading that turns at a capped
 * speed, and a clock in ms mapped into a shape with `mapSpring`.
 *
 * ```ts
 * const system = createSpringSystem()
 * const sweep = system.createRamp(0, { rate: 270, target: Infinity })
 * const ring = system.createSpring(sweep, defineSpring({ duration: 300, dampingRatio: 1 }))
 *
 * system.advance(1000)
 * sweep.value // 270
 * ```
 *
 * A ramp costs nothing per frame unless something watches it: an
 * `onUpdate` listener, a following spring, or, on a bounded ramp, an
 * `onStop` listener or a pending `settled`. An unwatched ramp still
 * moves, and a read reports where it is.
 *
 * Ramps move on the system clock. It counts frame time, `advance` calls,
 * and the time a started system spends asleep, and stops while the
 * system is stopped. A sleeping system skips the time the page is
 * hidden. An awake system gets no frames in a hidden tab, so the hidden
 * spell counts as one frame on return: `adjustedLag` ms if it lasted
 * longer than `lagThreshold`, in full otherwise or with lag clamping off.
 *
 * The clock holds still through synchronous code, so every read in one
 * event handler or render sees the same moment. A ramp created and read
 * with no `await` in between reads its starting value.
 *
 * Under reduced motion, a `'motion'` ramp jumps to a bounded target, and
 * an endless one holds still until reduced motion turns off, then
 * resumes. A `'nonmotion'` ramp keeps moving.
 */
export class Ramp implements TargetedSource {
  /** Brands the ramp as a `TargetedSource` whose api is the ramp itself. */
  get [SpringSourceSymbol](): TargetedSourceApi<number> {
    registerBacking(this, this.#motion)
    return this
  }

  readonly #motion: RampMotion
  readonly #purpose: Purpose
  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null

  constructor(motions: MotionSet, from: number, options: RampOptions) {
    invariant(
      typeof options === 'object' && options !== null,
      'createRamp needs options with a rate',
    )
    const { rate, target = from, purpose = 'motion' } = options
    assertValue(from)
    assertRate(rate)
    assertTarget(target)
    invariant(
      purpose === 'motion' || purpose === 'nonmotion',
      "Ramp purpose must be 'motion' or 'nonmotion'",
    )
    this.#purpose = purpose
    this.#motion = new RampMotion(motions, from, rate, target, purpose)
  }

  /**
   * The current value.
   *
   * Assignment accepts a finite number. It moves the ramp there at once,
   * keeping its target and rate, and notifies update listeners
   * synchronously. Writing the
   * current value does nothing. Under reduced motion, a `'motion'` ramp
   * with a bounded target rests at the written value, which becomes its
   * target too.
   */
  get value(): number {
    return this.#motion.value
  }

  set value(value: number) {
    assertValue(value)
    this.#motion.value = value
  }

  /**
   * Where the ramp is heading, or `Infinity` or `-Infinity` for an
   * endless ramp.
   *
   * Assignment accepts any number but `NaN`, and sends the ramp toward the
   * new target at its current rate.
   * It emits `start` if the ramp was resting, and no `update`, since the
   * value has not moved. Under reduced motion, a `'motion'` ramp jumps to
   * a bounded target, notifying update listeners, and holds still toward
   * an endless one.
   */
  get target(): number {
    return this.#motion.target
  }

  set target(target: number) {
    assertTarget(target)
    this.#motion.target = target
  }

  /**
   * The ramp's speed, in value units per second.
   *
   * Assignment accepts any finite number >= 0 and applies from the
   * current value on. A rate of 0 rests the ramp where it is.
   */
  get rate(): number {
    return this.#motion.rate
  }

  set rate(rate: number) {
    assertRate(rate)
    this.#motion.rate = rate
  }

  /**
   * The current velocity, in value units per second. It is `rate`
   * signed toward the target while the ramp moves, and 0 at rest.
   */
  get velocity(): number {
    return this.#motion.velocity
  }

  /** Always 0, since a ramp moves at a constant speed. */
  get acceleration(): number {
    return 0
  }

  /**
   * What the ramp drives, `'motion'` or `'nonmotion'`, fixed when the
   * ramp was created. A `'nonmotion'` ramp ignores reduced motion. See
   * `Purpose`.
   */
  get purpose(): Purpose {
    return this.#purpose
  }

  /**
   * Whether the ramp is still: at its target, at a rate of 0, held under
   * reduced motion, or disposed.
   */
  get isResting(): boolean {
    return this.#motion.isResting
  }

  /**
   * The time until the ramp reaches its target, in ms. It is 0 at rest,
   * and `Infinity` while the ramp moves toward an endless target.
   */
  get timeRemaining(): number {
    return this.#motion.timeRemaining
  }

  /**
   * A promise that resolves when the ramp next comes to rest. Already
   * resolved while the ramp rests and after dispose. A pending
   * `settled` keeps a bounded ramp in the frame loop, so the promise
   * resolves on the frame the ramp arrives.
   *
   * ```ts
   * ramp.target = 100
   * await ramp.settled
   * // the ramp is at 100
   * ```
   */
  get settled(): Promise<void> {
    if (this.#motion.disposed || this.#motion.isResting) return RESOLVED

    this.#settled ??= new Promise((resolve) => {
      this.#resolveSettled = resolve
      const unsubscribe = this.onStop(() => {
        unsubscribe()
        this.#settled = null
        this.#resolveSettled = null
        resolve()
      })
    })

    return this.#settled
  }

  /**
   * Rests the ramp at `value`, which becomes both its value and target.
   * Notifies update listeners synchronously, and emits `stop` if the ramp
   * was moving.
   */
  jumpTo(value: number) {
    assertValue(value)
    this.#motion.jumpTo(value)
  }

  /**
   * Releases the ramp permanently. It stops where it is, `settled`
   * resolves, and dispose listeners run. Followers detach and keep their
   * current target. Calling it again does nothing.
   *
   * The final value stays readable, and writes throw.
   */
  dispose() {
    if (this.#motion.disposed) return
    const resolve = this.#resolveSettled
    this.#settled = null
    this.#resolveSettled = null
    this.#motion.dispose()
    resolve?.()
  }

  /**
   * Subscribes to value changes: every frame the ramp moves, plus
   * synchronous `value` writes, `jumpTo` calls, and reduced-motion jumps.
   * A subscribed listener keeps the ramp in the frame loop. Returns an
   * unsubscribe function.
   */
  onUpdate(callback: () => void): () => void {
    return this.#motion.onUpdate(callback)
  }

  /**
   * Subscribes to the ramp leaving rest. `start` and `stop` alternate.
   * Returns an unsubscribe function.
   */
  onStart(callback: () => void): () => void {
    return this.#motion.onStart(callback)
  }

  /**
   * Subscribes to the ramp coming to rest: arriving at its target,
   * `jumpTo`, a rate of 0, or holding under reduced motion. A subscribed
   * listener keeps a bounded ramp in the frame loop, so the event fires
   * on the frame it arrives. Returns an unsubscribe function.
   */
  onStop(callback: () => void): () => void {
    return this.#motion.onStop(callback)
  }

  /** Subscribes to `dispose`, which fires once. Returns an unsubscribe function. */
  onDispose(callback: () => void): () => void {
    return this.#motion.onDispose(callback)
  }
}
