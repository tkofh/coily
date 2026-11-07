import { Emitter } from './emitter.ts'
import { Motion } from './motion.ts'
import type { MotionSet } from './motion-set.ts'
import type { Purpose } from './spring.ts'
import { invariant } from './util.ts'

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
export class RampMotion extends Motion {
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
  /** Whether the ramp is in the set's `reducible` registry. */
  #reducible = false
  /** The motion state listeners last heard: true after `start`, false after `stop`. */
  #running: boolean
  #updateListeners = 0
  #stopListeners = 0

  /** The advance phase `#stepped` belongs to, or 0. */
  #phase = 0
  #stepped = 0

  constructor(motions: MotionSet, from: number, rate: number, target: number, purpose: Purpose) {
    super()
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
   * ramp resumes from where it holds. Applying the current setting again
   * changes nothing.
   */
  applyReducedMotion(reduced: boolean) {
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

  advance(h: number) {
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

  endFrame() {
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

  /** 0: nothing knocks a ramp off its straight line. */
  manifoldDeviation(): number {
    return 0
  }

  /** 0: a ramp's speed changes only at arrival and on writes. */
  get acceleration(): number {
    return 0
  }

  /** True when a bounded ramp arrives within the next `dt` seconds, ending its slope there. */
  kinksWithin(dt: number): boolean {
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

  // Reconciles tick membership, the `reducible` registry, and the
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

    const reducible = this.#reduces && !this.#disposed && (moving || this.#held)
    if (reducible !== this.#reducible) {
      this.#reducible = reducible
      if (reducible) this.#motions.reducible.add(this)
      else this.#motions.reducible.delete(this)
    }

    if (moving !== this.#running) {
      this.#running = moving
      this.#emitter.emit(moving ? 'start' : 'stop')
    }
  }
}
