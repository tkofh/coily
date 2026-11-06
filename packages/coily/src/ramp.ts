import { Emitter } from './emitter.ts'
import { type FollowEdge, registerBacking } from './follow-graph.ts'
import type { TargetedSource, TargetedSourceApi } from './kinematic-source.ts'
import type { MotionSet } from './motion-set.ts'
import type { Purpose } from './spring.ts'
import { SpringSourceSymbol } from './spring-source.ts'
import { nextTickMemberId } from './motion.ts'
import type { TickMember } from './tick-member.ts'
import { invariant, RESOLVED } from './util.ts'

/**
 * A ramp's place in the system: a value moving toward its target at a
 * fixed speed, read from an anchor on the system clock.
 *
 * The anchor is the canonical state. The value at clock time `t` is
 * `anchorValue + speed * (t - anchorTime)` toward the target, clamped
 * there, and every write re-anchors at the current value first, so a
 * write changes only what happens from now on. The ramp joins the tick
 * only while something needs it frame by frame (an update listener, or
 * a stop listener on a bounded ramp). Outside the tick it still moves,
 * because the formula reads the clock, and it emits nothing.
 *
 * Inside an advance phase the tick steps a cached value by `rate * h`
 * per sub-step, so a follower recoupling mid-frame reads the ramp where
 * the sub-step leaves it. Between phases reads use the formula again.
 */
export class RampMotion implements TickMember {
  // Tick bookkeeping; see `TickMember` for what each field means.
  readonly _id = nextTickMemberId()
  _pass = 0
  _frame = 0
  _rank = -1
  _edge: FollowEdge | null = null
  _followers: FollowEdge[] | null = null
  // The system's ramp registry applies reduced motion to ramps,
  // watched or not, so `MotionSet.finishAll` leaves them alone.
  respectsReducedMotion = false

  readonly #motions: MotionSet
  readonly #emitter = new Emitter()
  /** Whether reduced motion applies: false for a `'nonmotion'` ramp. */
  readonly #reduces: boolean

  #anchorValue: number
  /** Clock seconds at which `#anchorValue` holds. */
  #anchorTime: number
  #target: number
  /** Value units per second. */
  #rate: number
  /** An endless ramp holding still under reduced motion. */
  #held = false
  #disposed = false

  /** Whether the ramp is in the `MotionSet`. */
  #ticking = false
  /** Whether the ramp is in the set's ramp registry. */
  #registered = false
  /** The motion state listeners last heard: true after `start`, false after `stop`. */
  #running: boolean
  #updateListeners = 0
  #stopListeners = 0

  /** The advance phase `#stepped` belongs to, or 0. */
  #phase = 0
  #stepped = 0

  constructor(motions: MotionSet, from: number, rate: number, target: number, purpose: Purpose) {
    this.#motions = motions
    this.#reduces = purpose === 'motion'
    this.#anchorValue = from
    this.#anchorTime = motions.time
    this.#target = target
    this.#rate = rate
    if (this.#reduces && motions.reduced) {
      if (Number.isFinite(target)) {
        this.#anchorValue = target
      } else {
        this.#held = true
      }
    }
    this.#running = !this.isResting
    this.#sync()
  }

  get value(): number {
    if (this.#phase !== 0 && this.#phase === this.#motions.advancing) return this.#stepped
    return this.#at(this.#motions.time)
  }

  get target(): number {
    return this.#target
  }

  get rate(): number {
    return this.#rate
  }

  get isResting(): boolean {
    return this.#speed() === 0 || this.value === this.#target
  }

  get velocity(): number {
    const value = this.value
    const speed = this.#speed()
    if (speed === 0 || value === this.#target) return 0
    return this.#target > value ? speed : -speed
  }

  /** Milliseconds until arrival: 0 at rest, Infinity while moving toward an infinite target. */
  get timeRemaining(): number {
    const value = this.value
    const speed = this.#speed()
    if (speed === 0 || value === this.#target) return 0
    return (Math.abs(this.#target - value) / speed) * 1000
  }

  set value(value: number) {
    this.#assertLive()
    if (value === this.value) return
    this.#anchorValue = value
    this.#anchorTime = this.#motions.time
    // A write under reduced motion lands at rest where it was written,
    // as a spring's does. An endless ramp keeps its direction and
    // resumes from here when reduced motion turns off.
    if (this.#reduces && this.#motions.reduced && Number.isFinite(this.#target)) {
      this.#target = value
    }
    this.#emitter.emit('update')
    this.#sync()
  }

  set target(target: number) {
    this.#assertLive()
    this.#reanchor()
    this.#target = target
    const endless = !Number.isFinite(target)
    if (this.#reduces && this.#motions.reduced) {
      this.#held = endless
      if (!endless && this.#anchorValue !== target) {
        this.#anchorValue = target
        this.#emitter.emit('update')
      }
    } else {
      this.#held = false
    }
    this.#sync()
  }

  set rate(rate: number) {
    this.#assertLive()
    this.#reanchor()
    this.#rate = rate
    this.#sync()
  }

  jumpTo(value: number) {
    this.#assertLive()
    this.#anchorValue = value
    this.#anchorTime = this.#motions.time
    this.#target = value
    this.#held = false
    this.#emitter.emit('update')
    this.#sync()
  }

  /**
   * Applies a change of the reduced-motion setting: a bounded ramp
   * finishes at its target, an endless one holds where it is, and a held
   * ramp resumes from where it holds. `MotionSet.setReduced` calls this
   * on every registered ramp after updating `reduced`.
   */
  _applyReduced(reduced: boolean) {
    if (!this.#reduces || this.#disposed) return
    if (reduced) {
      if (Number.isFinite(this.#target)) {
        if (this.value !== this.#target) {
          this.#anchorValue = this.#target
          this.#anchorTime = this.#motions.time
          this.#emitter.emit('update')
        }
      } else if (!this.#held) {
        this.#reanchor()
        this.#held = true
      }
    } else if (this.#held) {
      this.#reanchor()
      this.#held = false
    }
    this.#sync()
  }

  finish() {
    this._applyReduced(true)
  }

  _advance(h: number) {
    const phase = this.#motions.advancing
    if (this.#phase !== phase) {
      this.#phase = phase
      this.#stepped = this.#at(this.#motions.time)
    }
    const speed = this.#speed()
    const remaining = this.#target - this.#stepped
    if (speed === 0 || remaining === 0) return
    const step = speed * h
    this.#stepped =
      Math.abs(remaining) <= step ? this.#target : this.#stepped + Math.sign(remaining) * step
  }

  _settleFrame() {
    // Sub-steps sum to the frame's dt only to rounding, so an arrival the
    // steps reached is pinned in the anchor, where the formula sees it
    // too.
    if (this.#stepped === this.#target && this.#anchorValue !== this.#target) {
      this.#anchorValue = this.#target
      this.#anchorTime = this.#motions.time
    }
    this.#phase = 0
    this.#emitter.emit('update')
    this.#sync()
  }

  _manifoldDeviation(): number {
    return 0
  }

  _acceleration(): number {
    return 0
  }

  _kinksWithin(dt: number): boolean {
    const speed = this.#speed()
    if (speed === 0 || !Number.isFinite(this.#target)) return false
    const arrival = Math.abs(this.#target - this.value) / speed
    return arrival > 0 && arrival <= dt
  }

  onUpdate(callback: () => void): () => void {
    return this.#listen('update', callback)
  }

  onStart(callback: () => void): () => void {
    return this.#emitter.on('start', callback)
  }

  onStop(callback: () => void): () => void {
    return this.#listen('stop', callback)
  }

  onDispose(callback: () => void): () => void {
    return this.#emitter.on('dispose', callback)
  }

  dispose() {
    if (this.#disposed) return
    this.#reanchor()
    this.#disposed = true
    this.#emitter.emit('dispose')
    this.#emitter.clear()
    this.#sync()
  }

  get disposed(): boolean {
    return this.#disposed
  }

  #speed(): number {
    return this.#held || this.#disposed ? 0 : this.#rate
  }

  #at(time: number): number {
    const speed = this.#speed()
    const remaining = this.#target - this.#anchorValue
    if (speed === 0 || remaining === 0) return this.#anchorValue
    // The clock never runs backward, but an idle credit can land a hair
    // behind a read taken just before it.
    const travel = speed * Math.max(0, time - this.#anchorTime)
    return Math.abs(remaining) <= travel
      ? this.#target
      : this.#anchorValue + Math.sign(remaining) * travel
  }

  #reanchor() {
    const time = this.#motions.time
    this.#anchorValue = this.#at(time)
    this.#anchorTime = time
  }

  #assertLive() {
    invariant(!this.#disposed, 'Cannot write to a disposed ramp')
  }

  #listen(type: 'update' | 'stop', callback: () => void): () => void {
    // Settle any arrival that happened unwatched first, so the new
    // listener never hears a stale `stop`.
    this.#sync()
    const off = this.#emitter.on(type, callback)
    if (type === 'update') this.#updateListeners++
    else this.#stopListeners++
    this.#sync()
    let active = true
    return () => {
      if (!active) return
      active = false
      off()
      if (type === 'update') this.#updateListeners--
      else this.#stopListeners--
      this.#sync()
    }
  }

  // Reconciles tick membership, the reduced-motion registry, and the
  // start/stop state with the ramp's current motion. Events go last, so
  // a listener that writes to the ramp re-syncs from settled state.
  #sync() {
    const moving = !this.#disposed && !this.isResting
    const watched =
      this.#updateListeners > 0 || (this.#stopListeners > 0 && Number.isFinite(this.#target))
    const ticking = moving && watched
    if (ticking !== this.#ticking) {
      this.#ticking = ticking
      if (ticking) this.#motions.add(this)
      else this.#motions.remove(this)
    }

    const registered = this.#reduces && !this.#disposed && (moving || this.#held)
    if (registered !== this.#registered) {
      this.#registered = registered
      if (registered) this.#motions.ramps.add(this)
      else this.#motions.ramps.delete(this)
    }

    if (moving !== this.#running) {
      this.#running = moving
      this.#emitter.emit(moving ? 'start' : 'stop')
    }
  }
}

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
