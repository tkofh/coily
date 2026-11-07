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
   * The ramp's speed, in value units per second. Must be finite and at
   * least 0; a rate of 0 rests the ramp where it is.
   */
  rate: number
  /**
   * Where the ramp heads. `Infinity` or `-Infinity` makes it endless in
   * that direction.
   * @default the starting value, so the ramp starts at rest
   */
  target?: number | undefined
  /**
   * What the ramp drives, which decides whether reduced motion applies
   * to it. Under reduced motion a `'motion'` ramp jumps to a bounded
   * target and holds still on an endless one; a `'nonmotion'` ramp, such
   * as a clock for logic, keeps moving. Fixed for the ramp's life. See
   * `Purpose`.
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
 * A ramp is a `SpringSource`, so a spring can follow it. The spring
 * integrates against the ramp's steady motion exactly, where a target
 * assigned once per frame would reach it as a staircase. Typical uses
 * are an endless spin, a heading that slews at a capped speed, and a
 * clock in milliseconds mapped into a shape with `mapSpring`.
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
 * The value is a function of time, so a ramp costs nothing per frame
 * unless something listens to it frame by frame: an `onUpdate`
 * listener, including any spring that follows the ramp, or, on a
 * bounded ramp, an `onStop` listener or a pending `settled`. An
 * unwatched ramp keeps moving on the system's clock and reports where
 * it is whenever it is read. That clock counts each frame's time,
 * `advance` calls, and the time a started system spends asleep. It
 * stops while the system is stopped and while the page is hidden.
 *
 * The clock holds still through synchronous code, so every read in one
 * event handler or one render sees the same moment, and a ramp created
 * and read without an `await` between reads its starting value.
 *
 * Under reduced motion a ramp behaves like a spring with the same
 * `purpose`: a `'motion'` ramp jumps to a bounded target, and an
 * endless one holds still and resumes when reduced motion turns off.
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
   * The current value, where the ramp is now.
   *
   * Assignment moves the ramp to the written value at once, notifying
   * update listeners synchronously. It keeps its target and rate and
   * carries on from there. Writing the current value is a no-op. Under
   * reduced motion a `'motion'` ramp with a bounded target rests where
   * it is written, target included.
   */
  get value(): number {
    return this.#motion.value
  }

  set value(value: number) {
    assertValue(value)
    this.#motion.value = value
  }

  /**
   * Where the ramp is heading: a number, or `Infinity` or `-Infinity`
   * for an endless ramp.
   *
   * Assignment heads the ramp to the new target from its current value
   * at its current rate. It emits no `update`, since the value has not
   * moved, and emits `start` if the ramp was resting. Under reduced
   * motion a `'motion'` ramp jumps to a bounded target, notifying update
   * listeners, and holds still toward an endless one.
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
   * current value on: the distance already covered stays covered. A rate
   * of 0 rests the ramp where it is.
   */
  get rate(): number {
    return this.#motion.rate
  }

  set rate(rate: number) {
    assertRate(rate)
    this.#motion.rate = rate
  }

  /**
   * The current velocity, in value units per second: `rate`, signed
   * toward the target, while the ramp moves, and 0 at rest. Read-only.
   */
  get velocity(): number {
    return this.#motion.velocity
  }

  /** Always 0: a ramp's speed never changes along the way. Read-only. */
  get acceleration(): number {
    return 0
  }

  /**
   * What the ramp drives, `'motion'` or `'nonmotion'`, fixed when it was
   * created. A `'nonmotion'` ramp ignores reduced motion. See `Purpose`.
   */
  get purpose(): Purpose {
    return this.#purpose
  }

  /**
   * Whether the ramp is still: at its target, at a rate of 0, or holding
   * under reduced motion.
   */
  get isResting(): boolean {
    return this.#motion.isResting
  }

  /**
   * Milliseconds until the ramp reaches its target: 0 at rest, and
   * Infinity while it moves toward an infinite target.
   */
  get timeRemaining(): number {
    return this.#motion.timeRemaining
  }

  /**
   * A promise that resolves when the ramp next comes to rest, already
   * resolved while resting or after dispose. A pending `settled` keeps a
   * bounded ramp in the frame loop, so it resolves on the frame the ramp
   * arrives.
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
   * Places the ramp at `value` and rests it there: target and value both
   * become `value`. Notifies update listeners synchronously, plus `stop`
   * if the ramp was moving.
   */
  jumpTo(value: number) {
    assertValue(value)
    this.#motion.jumpTo(value)
  }

  /**
   * Releases the ramp permanently: it stops where it is, followers detach
   * keeping their current target, `settled` resolves, and dispose
   * listeners are notified. Calling it again is a no-op.
   *
   * A disposed ramp keeps its final value readable; writes throw.
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
   * While any update listener is subscribed, the ramp advances with the
   * frame loop. Returns an unsubscribe function.
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
   * `jumpTo`, a rate of 0, or holding under reduced motion. While any stop
   * listener is subscribed, a bounded ramp advances with the frame loop,
   * so the event fires on the frame it arrives. Returns an unsubscribe
   * function.
   */
  onStop(callback: () => void): () => void {
    return this.#motion.onStop(callback)
  }

  /** Subscribes to `dispose`, which fires once. Returns an unsubscribe function. */
  onDispose(callback: () => void): () => void {
    return this.#motion.onDispose(callback)
  }
}
