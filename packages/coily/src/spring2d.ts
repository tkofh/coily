import { SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import type { MotionSet } from './motion-set.ts'
import { Spring, type SpringPosition, type SpringTarget } from './spring.ts'
import { isVector2, type Vector2 } from './vector2.ts'

export interface Spring2DWithOffset {
  spring: Spring2D
  offset?: Vector2 | undefined
}

export type Spring2DTarget = Vector2 | Spring2D | Spring2DWithOffset

interface DisplacedSpring2DPosition {
  target?: Spring2DTarget | undefined
  value?: Vector2 | undefined
}

export type Spring2DPosition = Vector2 | DisplacedSpring2DPosition

function normalizeTarget2D(
  target: Spring2DTarget | undefined,
): { spring: Spring2D; offset: Vector2 | undefined } | null {
  if (target instanceof Spring2D) return { spring: target, offset: undefined }
  if (
    typeof target === 'object' &&
    target !== null &&
    'spring' in target &&
    target.spring instanceof Spring2D
  ) {
    return { spring: target.spring, offset: target.offset }
  }
  return null
}

function toScalarTarget(spring: Spring, offset: number | undefined): SpringTarget {
  return offset ? { spring, offset } : spring
}

function toScalarPos(target: SpringTarget, value: number | undefined): SpringPosition {
  if (typeof target === 'number') {
    return value !== undefined ? { target, value } : target
  }
  return { target, value }
}

const RESOLVED = Promise.resolve()

export class Spring2D {
  readonly #motions: MotionSet
  readonly #x: Spring
  readonly #y: Spring
  readonly #value: Vector2 = { x: 0, y: 0 }
  readonly #velocity: Vector2 = { x: 0, y: 0 }

  readonly #emitter = new Emitter()
  /** Composite animation state — `start`/`stop` fire only on its edges. */
  #running: boolean
  /** Set when an axis emits `update` — cleared by the flush. */
  #dirty = false

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  /**
   * Emits the coalesced composite events. Runs at most once per tick pass
   * (channel events schedule it through the motion set's `FlushQueue`), so
   * both axes are in their final per-frame state: `update` fires once with
   * no torn reads, and `stop` lands after the frame's final `update`.
   */
  readonly #flush = () => {
    if (this.#disposed) return

    if (this.#dirty) {
      this.#dirty = false
      this.#emitter.emit('update')
    }

    if (this.#running) {
      if (this.isResting) {
        this.#running = false
        this.#emitter.emit('stop')
      }
    } else if (!this.isResting) {
      this.#running = true
      this.#emitter.emit('start')
    }
  }

  constructor(motions: MotionSet, position: Spring2DPosition, config?: SpringConfig) {
    this.#motions = motions

    let xPos: SpringPosition
    let yPos: SpringPosition

    if (isVector2(position)) {
      xPos = position.x
      yPos = position.y
    } else {
      const normalized = normalizeTarget2D(position.target)
      if (normalized) {
        const lx = normalized.spring.#x
        const ly = normalized.spring.#y
        const xTarget = toScalarTarget(lx, normalized.offset?.x)
        const yTarget = toScalarTarget(ly, normalized.offset?.y)
        xPos = toScalarPos(xTarget, position.value?.x)
        yPos = toScalarPos(yTarget, position.value?.y)
      } else if (isVector2(position.target)) {
        const t = position.target
        xPos = { target: t.x, value: position.value?.x }
        yPos = { target: t.y, value: position.value?.y }
      } else {
        xPos = { target: position.target as number | undefined, value: position.value?.x }
        yPos = { target: undefined, value: position.value?.y }
      }
    }

    this.#x = new Spring(motions, xPos, config)
    this.#y = new Spring(motions, yPos, config)
    this.#running = !this.isResting

    const markDirty = () => {
      this.#dirty = true
      this.#motions.flushes.request(this.#flush)
    }
    const schedule = () => {
      this.#motions.flushes.request(this.#flush)
    }
    this.#x.onUpdate(markDirty)
    this.#y.onUpdate(markDirty)
    this.#x.onStart(schedule)
    this.#y.onStart(schedule)
    this.#x.onStop(schedule)
    this.#y.onStop(schedule)
  }

  get target(): Vector2 {
    return { x: this.#x.target, y: this.#y.target }
  }

  set target(value: Spring2DTarget) {
    this.#motions.flushes.batch(() => {
      if (value instanceof Spring2D) {
        this.#x.target = value.#x
        this.#y.target = value.#y
      } else if ('spring' in value && value.spring instanceof Spring2D) {
        const { spring, offset } = value as Spring2DWithOffset
        this.#x.target = toScalarTarget(spring.#x, offset?.x)
        this.#y.target = toScalarTarget(spring.#y, offset?.y)
      } else {
        const v = value as Vector2
        this.#x.target = v.x
        this.#y.target = v.y
      }
    })
  }

  get value(): Readonly<Vector2> {
    this.#value.x = this.#x.value
    this.#value.y = this.#y.value
    return this.#value
  }

  set value(value: Vector2) {
    this.#motions.flushes.batch(() => {
      this.#x.value = value.x
      this.#y.value = value.y
    })
  }

  get velocity(): Readonly<Vector2> {
    this.#velocity.x = this.#x.velocity
    this.#velocity.y = this.#y.velocity
    return this.#velocity
  }

  set velocity(value: Vector2) {
    this.#motions.flushes.batch(() => {
      this.#x.velocity = value.x
      this.#y.velocity = value.y
    })
  }

  get config() {
    return this.#x.config
  }

  get mass() {
    return this.#x.mass
  }

  get tension() {
    return this.#x.tension
  }

  get damping() {
    return this.#x.damping
  }

  get dampingRatio() {
    return this.#x.dampingRatio
  }

  get precision() {
    return this.#x.precision
  }

  set config(value: SpringConfig | null) {
    this.#motions.flushes.batch(() => {
      this.#x.config = value
      this.#y.config = value
    })
  }

  // ── State ───────────────────────────────────────────────────────

  get timeRemaining() {
    return Math.max(this.#x.timeRemaining, this.#y.timeRemaining)
  }

  get isResting() {
    return this.#x.isResting && this.#y.isResting
  }

  /**
   * Resolves when both axes next come to rest — immediately if already
   * resting. The same promise is returned for the duration of a motion
   * cycle, and retargeting mid-flight extends the wait: it resolves only
   * at true rest. Disposing the spring resolves a pending promise.
   */
  get settled(): Promise<void> {
    if (this.#disposed || this.isResting) return RESOLVED

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

  // ── Lifecycle ───────────────────────────────────────────────────

  jumpTo(value: Vector2) {
    this.#motions.flushes.batch(() => {
      this.#x.jumpTo(value.x)
      this.#y.jumpTo(value.y)
    })
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    if (this.#resolveSettled) {
      this.#resolveSettled()
      this.#settled = null
      this.#resolveSettled = null
    }

    this.#x.dispose()
    this.#y.dispose()
    this.#emitter.clear()
  }

  // ── Events ──────────────────────────────────────────────────────

  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  onDispose(callback: () => void) {
    // Both axes dispose together and only through this class, so one axis
    // is a sufficient signal.
    return this.#x.onDispose(callback)
  }
}
