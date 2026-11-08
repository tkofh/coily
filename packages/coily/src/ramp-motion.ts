import { Emitter } from './emitter.ts'
import { Motion } from './motion.ts'
import type { MotionSet } from './motion-set.ts'
import type { Purpose } from './spring.ts'
import { invariant } from './util.ts'

/**
 * A ramp's motion, computed from an anchor on the system clock.
 *
 * At clock time `t` the value is `anchorValue + speed * (t - anchorTime)`
 * toward the target, clamped there. Every write re-anchors at the
 * current value first. The ramp joins the tick only while an update
 * listener, or a stop listener on a bounded ramp, needs it per frame.
 * Outside the tick it still moves, but emits no frame events, not even
 * `stop` on arrival.
 *
 * Within an advance phase, `advance` steps a cached value by `speed * h`
 * per sub-step, so a follower recoupling mid-frame reads the sub-step's
 * position. Between phases, reads use the formula.
 */
export class RampMotion extends Motion {
  readonly #emitter = new Emitter()
  /** Whether reduced motion applies: false for a `'nonmotion'` ramp. */
  readonly #reduces: boolean

  #anchorValue: number
  /** Clock seconds at which `#anchorValue` holds. */
  #anchorTime: number
  #target: number
  /** Value units per second. */
  #rate: number
  /** Whether the ramp is endless and holds still under reduced motion. */
  #held = false
  #disposed = false

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
    super(motions)
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
    if (this.#phase !== 0 && this.#phase === this.owner.advancing) return this.#stepped
    return this.#at(this.owner.time)
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

  /** Time until arrival, in ms: 0 at rest, Infinity while moving toward an infinite target. */
  get timeRemaining(): number {
    const value = this.value
    const speed = this.#speed()
    if (speed === 0 || value === this.#target) return 0
    return (Math.abs(this.#target - value) / speed) * 1000
  }

  set value(value: number) {
    this.#beginWrite()
    if (value === this.value) return
    this.#anchorValue = value
    this.#anchorTime = this.owner.time
    // Under reduced motion a write rests where it lands, as a spring's
    // does. An endless ramp resumes from here when reduced motion ends.
    if (this.#reduces && this.owner.reduced && Number.isFinite(this.#target)) {
      this.#target = value
    }
    this.#emitter.emit('update')
    this.#sync()
  }

  set target(target: number) {
    this.#beginWrite()
    this.#reanchor()
    this.#target = target
    const endless = !Number.isFinite(target)
    if (this.#reduces && this.owner.reduced) {
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
    this.#beginWrite()
    this.#reanchor()
    this.#rate = rate
    this.#sync()
  }

  jumpTo(value: number) {
    this.#beginWrite()
    this.#anchorValue = value
    this.#anchorTime = this.owner.time
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
          this.#anchorTime = this.owner.time
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
    const phase = this.owner.advancing
    if (this.#phase !== phase) {
      this.#phase = phase
      this.#stepped = this.#at(this.owner.time)
    }
    const speed = this.#speed()
    const remaining = this.#target - this.#stepped
    if (speed === 0 || remaining === 0) return
    const step = speed * h
    this.#stepped =
      Math.abs(remaining) <= step ? this.#target : this.#stepped + Math.sign(remaining) * step
  }

  endFrame() {
    // Sub-steps sum to dt only up to rounding, so pin an arrival the
    // steps reached into the anchor for the formula to see.
    if (this.#stepped === this.#target && this.#anchorValue !== this.#target) {
      this.#anchorValue = this.#target
      this.#anchorTime = this.owner.time
    }
    this.#phase = 0
    this.#emitter.emit('update')
    this.#sync()
  }

  reconcile() {
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
    // The clock only moves forward, but idle time comes from
    // `performance.now()`, and a wall clock that reads earlier (a test
    // stub) must not move the ramp back past its anchor.
    const travel = speed * Math.max(0, time - this.#anchorTime)
    return Math.abs(remaining) <= travel
      ? this.#target
      : this.#anchorValue + Math.sign(remaining) * travel
  }

  #reanchor() {
    const time = this.owner.time
    this.#anchorValue = this.#at(time)
    this.#anchorTime = time
  }

  // An unwatched ramp's start/stop state can lag its motion. Settling it
  // first lets the write's own `start` fire when it moves the ramp off rest.
  #beginWrite() {
    invariant(!this.#disposed, 'Cannot write to a disposed ramp')
    this.#sync()
  }

  #listen(type: 'update' | 'stop', callback: () => void): () => void {
    // Settle an unwatched arrival first, so the new listener never hears
    // a stale `stop`.
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
    if (ticking !== this.owner.has(this)) {
      if (ticking) this.owner.add(this)
      else this.owner.remove(this)
    }

    const reducible = this.#reduces && !this.#disposed && (moving || this.#held)
    if (reducible !== this.#reducible) {
      this.#reducible = reducible
      if (reducible) this.owner.reducible.add(this)
      else this.owner.reducible.delete(this)
    }

    if (moving !== this.#running) {
      this.#running = moving
      this.#emitter.emit(moving ? 'start' : 'stop')
    }
  }
}
