import { SpringConfig } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { Motion } from './motion.ts'

// ── Position Types ───────────────────────────────────────────────────

interface DisplacedSpringPosition {
  target?: number | undefined
  value?: number | undefined
}

export type SpringPosition = number | DisplacedSpringPosition

export interface LinkedSpringPosition {
  target: SpringBase
  offset?: number | undefined
  value?: number | undefined
}

function isLinkedPosition(
  position: SpringPosition | LinkedSpringPosition,
): position is LinkedSpringPosition {
  return (
    typeof position === 'object' && 'target' in position && position.target instanceof SpringBase
  )
}

// ── SpringBase ───────────────────────────────────────────────────────

export abstract class SpringBase {
  #target: number
  #config: SpringConfig
  readonly #motion: Motion
  readonly #motions: MotionSet

  constructor(motions: MotionSet, target: number, value: number, config: SpringConfig) {
    this.#target = target
    this.#config = config
    this.#motion = new Motion(config, value - target, 0)
    this.#motions = motions

    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }
  }

  get target() {
    return this.#target
  }

  get value() {
    return this.#target + this.#motion.position
  }

  set value(value: number) {
    const position = value - this.#target
    if (position !== this.#motion.position) {
      this.#motions.add(this.#motion)

      this.#motion.position = position
      this.#motion.tick(0)
    }
  }

  get velocity() {
    return this.#motion.velocity
  }

  set velocity(value: number) {
    this.#motions.add(this.#motion)
    this.#motion.velocity = value
  }

  get config() {
    return this.#config
  }

  get mass() {
    return this.#config.mass
  }

  get tension() {
    return this.#config.tension
  }

  get damping() {
    return this.#config.damping
  }

  get dampingRatio() {
    return this.#config.dampingRatio
  }

  get precision() {
    return this.#config.precision
  }

  get timeRemaining() {
    return this.#motion.timeRemaining
  }

  get isResting() {
    return this.#motion.isResting
  }

  configure(config: SpringConfig) {
    SpringConfig.assign(this.#config, config)
    // Motion will detect the version change on next tick.
    // But we need to ensure it's in the active set to get ticked.
    this.#motions.add(this.#motion)
  }

  onUpdate(callback: () => void) {
    return this.#motion.onUpdate(callback)
  }

  onStart(callback: () => void) {
    return this.#motion.onStart(callback)
  }

  onStop(callback: () => void) {
    return this.#motion.onStop(callback)
  }

  jumpTo(value: number) {
    this.#target = value
    this.#motion.position = 0
    this.#motion.velocity = 0
    this.#motion.tick(0)
  }

  dispose() {
    this.#motions.remove(this.#motion)
    this.#motion.dispose()
  }

  protected setConfig(config: SpringConfig) {
    this.#config = config
    this.#motions.add(this.#motion)
  }

  protected setTarget(value: number) {
    if (value !== this.#target) {
      this.#motions.add(this.#motion)

      const currentValue = this.value
      this.#target = value
      this.#motion.position = currentValue - this.#target
      this.#motion.tick(0)
    }
  }
}

// ── Spring ───────────────────────────────────────────────────────────

export class Spring extends SpringBase {
  constructor(motions: MotionSet, position: SpringPosition, config: SpringConfig) {
    let target: number
    let value: number

    if (typeof position === 'number') {
      target = position
      value = position
    } else {
      target = position.target ?? position.value ?? 0
      value = position.value ?? target
    }

    super(motions, target, value, config)
  }

  override get target() {
    return super.target
  }

  override set target(value: number) {
    this.setTarget(value)
  }
}

// ── LinkedSpring ─────────────────────────────────────────────────────

export class LinkedSpring extends SpringBase {
  readonly #leader: SpringBase
  #offset: number
  #hasConfigOverride: boolean
  readonly #unsubUpdate: () => void

  constructor(motions: MotionSet, position: LinkedSpringPosition, config?: SpringConfig) {
    const leader = position.target
    const offset = position.offset ?? 0
    const hasOverride = config !== undefined
    const target = leader.value + offset
    const value = position.value ?? target

    // Share the leader's config instance when no override is provided.
    // SpringConfig.assign mutates in place, so when the leader configures,
    // the follower's config is already updated — no listeners needed.
    const resolvedConfig = hasOverride ? config : leader.config

    super(motions, target, value, resolvedConfig)

    this.#leader = leader
    this.#offset = offset
    this.#hasConfigOverride = hasOverride

    this.#unsubUpdate = leader.onUpdate(() => {
      this.setTarget(this.#leader.value + this.#offset)
    })
  }

  get leader(): SpringBase {
    return this.#leader
  }

  get offset() {
    return this.#offset
  }

  set offset(value: number) {
    if (value !== this.#offset) {
      this.#offset = value
      this.setTarget(this.#leader.value + this.#offset)
    }
  }

  override configure(config: SpringConfig) {
    if (!this.#hasConfigOverride) {
      // Fork: create our own config instance so we don't mutate the leader's
      this.#hasConfigOverride = true
      this.setConfig(
        new SpringConfig({
          tension: this.config.tension,
          damping: this.config.damping,
          mass: this.config.mass,
          precision: this.config.precision,
        }),
      )
    }
    super.configure(config)
  }

  clearConfigOverride() {
    this.#hasConfigOverride = false
    this.setConfig(this.#leader.config)
  }

  override dispose() {
    this.#unsubUpdate()
    super.dispose()
  }
}

export { isLinkedPosition }
