import { SpringConfig } from './config.ts'
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

export class Spring2D {
  readonly #x: Spring
  readonly #y: Spring
  readonly #value: Vector2 = { x: 0, y: 0 }
  readonly #velocity: Vector2 = { x: 0, y: 0 }

  constructor(motions: MotionSet, position: Spring2DPosition, config?: SpringConfig) {
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
  }

  get target(): Vector2 {
    return { x: this.#x.target, y: this.#y.target }
  }

  set target(value: Spring2DTarget) {
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
  }

  get value(): Readonly<Vector2> {
    this.#value.x = this.#x.value
    this.#value.y = this.#y.value
    return this.#value
  }

  set value(value: Vector2) {
    this.#x.value = value.x
    this.#y.value = value.y
  }

  get velocity(): Readonly<Vector2> {
    this.#velocity.x = this.#x.velocity
    this.#velocity.y = this.#y.velocity
    return this.#velocity
  }

  set velocity(value: Vector2) {
    this.#x.velocity = value.x
    this.#y.velocity = value.y
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
    this.#x.config = value
    this.#y.config = value
  }

  // ── State ───────────────────────────────────────────────────────

  get timeRemaining() {
    return Math.max(this.#x.timeRemaining, this.#y.timeRemaining)
  }

  get isResting() {
    return this.#x.isResting && this.#y.isResting
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  jumpTo(value: Vector2) {
    this.#x.jumpTo(value.x)
    this.#y.jumpTo(value.y)
  }

  dispose() {
    this.#x.dispose()
    this.#y.dispose()
  }

  // ── Events ──────────────────────────────────────────────────────

  onUpdate(callback: () => void) {
    const a = this.#x.onUpdate(callback)
    const b = this.#y.onUpdate(callback)
    return () => {
      a()
      b()
    }
  }

  onStart(callback: () => void) {
    const a = this.#x.onStart(callback)
    const b = this.#y.onStart(callback)
    return () => {
      a()
      b()
    }
  }

  onStop(callback: () => void) {
    const check = () => {
      if (this.isResting) callback()
    }
    const a = this.#x.onStop(check)
    const b = this.#y.onStop(check)
    return () => {
      a()
      b()
    }
  }
}
