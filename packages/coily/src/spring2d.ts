import type { SpringConfig } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { SpringObject } from './spring-object.ts'
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

/**
 * A two-axis spring — sugar over `SpringObject<Vector2>`, keeping the
 * vector-specific API (`Vector2` targets and offsets, per-axis config
 * getters). Composite event semantics come from the underlying object:
 * one `update` per frame, `stop` after the frame's final `update`.
 */
export class Spring2D {
  readonly #object: SpringObject<Vector2>

  constructor(motions: MotionSet, position: Spring2DPosition, config?: SpringConfig) {
    let initial: Vector2
    let follow: { leader: Spring2D; offset: Vector2 | undefined } | null = null
    let retarget: Vector2 | null = null

    if (isVector2(position)) {
      initial = { x: position.x, y: position.y }
    } else {
      const normalized = normalizeTarget2D(position.target)
      if (normalized) {
        const leaderValue = normalized.spring.value
        const base = {
          x: leaderValue.x + (normalized.offset?.x ?? 0),
          y: leaderValue.y + (normalized.offset?.y ?? 0),
        }
        initial = { x: position.value?.x ?? base.x, y: position.value?.y ?? base.y }
        follow = { leader: normalized.spring, offset: normalized.offset }
      } else if (isVector2(position.target)) {
        const t = position.target
        initial = { x: position.value?.x ?? t.x, y: position.value?.y ?? t.y }
        retarget = { x: t.x, y: t.y }
      } else {
        initial = { x: position.value?.x ?? 0, y: position.value?.y ?? 0 }
      }
    }

    this.#object = new SpringObject(motions, initial, config)

    // Displaced or following creation composes from create-at-value plus a
    // retarget — listeners cannot exist yet, so the difference is unobservable
    // (and under reduced motion both paths land at the target).
    if (follow) {
      this.#object.target = follow.offset
        ? { spring: follow.leader.#object, offset: follow.offset }
        : follow.leader.#object
    } else if (retarget && (retarget.x !== initial.x || retarget.y !== initial.y)) {
      this.#object.target = retarget
    }
  }

  get target(): Vector2 {
    const target = this.#object.target
    return { x: target.x, y: target.y }
  }

  set target(value: Spring2DTarget) {
    if (value instanceof Spring2D) {
      this.#object.target = value.#object
    } else if ('spring' in value && value.spring instanceof Spring2D) {
      const { spring, offset } = value as Spring2DWithOffset
      this.#object.target = offset ? { spring: spring.#object, offset } : spring.#object
    } else {
      const v = value as Vector2
      this.#object.target = { x: v.x, y: v.y }
    }
  }

  get value(): Readonly<Vector2> {
    return this.#object.value
  }

  set value(value: Vector2) {
    this.#object.value = value
  }

  get velocity(): Readonly<Vector2> {
    return this.#object.velocity
  }

  set velocity(value: Vector2) {
    this.#object.velocity = value
  }

  get config(): SpringConfig {
    // Both axes always share a config through this surface (uniform
    // creation, uniform assignment, and 2D leaders only), so the shared
    // config is never null here.
    return this.#object.config as SpringConfig
  }

  get mass() {
    return this.config.mass
  }

  get tension() {
    return this.config.tension
  }

  get damping() {
    return this.config.damping
  }

  get dampingRatio() {
    return this.config.dampingRatio
  }

  get precision() {
    return this.config.precision
  }

  set config(value: SpringConfig | null) {
    this.#object.config = value
  }

  // ── State ───────────────────────────────────────────────────────

  get timeRemaining() {
    return this.#object.timeRemaining
  }

  get isResting() {
    return this.#object.isResting
  }

  /**
   * Resolves when both axes next come to rest — immediately if already
   * resting. The same promise is returned for the duration of a motion
   * cycle, and retargeting mid-flight extends the wait: it resolves only
   * at true rest. Disposing the spring resolves a pending promise.
   */
  get settled(): Promise<void> {
    return this.#object.settled
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  jumpTo(value: Vector2) {
    this.#object.jumpTo(value)
  }

  dispose() {
    this.#object.dispose()
  }

  // ── Events ──────────────────────────────────────────────────────

  onUpdate(callback: () => void) {
    return this.#object.onUpdate(callback)
  }

  onStart(callback: () => void) {
    return this.#object.onStart(callback)
  }

  onStop(callback: () => void) {
    return this.#object.onStop(callback)
  }

  onDispose(callback: () => void) {
    return this.#object.onDispose(callback)
  }
}
