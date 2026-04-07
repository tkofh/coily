import { SpringConfig } from './config.ts'
import type { MotionSet } from './motion-set.ts'
import { Motion } from './motion.ts'

export interface SpringWithOffset {
  spring: Spring
  offset?: number | undefined
}

export type SpringTarget = number | Spring | SpringWithOffset

interface DisplacedSpringPosition {
  target?: SpringTarget | undefined
  value?: number | undefined
}

export type SpringPosition = number | DisplacedSpringPosition

function normalizeTarget(
  target: SpringTarget | undefined,
): { spring: Spring; offset: number } | null {
  if (target instanceof Spring) return { spring: target, offset: 0 }
  if (
    typeof target === 'object' &&
    target !== null &&
    'spring' in target &&
    target.spring instanceof Spring
  ) {
    return { spring: target.spring, offset: target.offset ?? 0 }
  }
  return null
}

export class Spring {
  #target: number
  #config: SpringConfig
  readonly #motion: Motion
  readonly #motions: MotionSet

  #leader: Spring | null = null
  #offset = 0
  #ownsConfig: boolean
  #unsubLeader: (() => void) | null = null

  constructor(motions: MotionSet, position: SpringPosition, config?: SpringConfig) {
    this.#motions = motions

    let numericTarget: number
    let value: number
    let normalized: { spring: Spring; offset: number } | null = null

    if (typeof position === 'number') {
      numericTarget = position
      value = position
    } else {
      normalized = normalizeTarget(position.target)
      if (normalized) {
        numericTarget =
          normalized.spring.#target + normalized.spring.#motion.position + normalized.offset
        value = position.value ?? numericTarget
      } else {
        numericTarget = (position.target as number | undefined) ?? position.value ?? 0
        value = position.value ?? numericTarget
      }
    }

    const hasOverride = config !== undefined
    this.#ownsConfig = hasOverride || !normalized

    if (normalized && !hasOverride) {
      this.#config = normalized.spring.#config
    } else {
      this.#config = config ?? SpringConfig.default
    }

    this.#target = numericTarget
    this.#motion = new Motion(this.#config, value - numericTarget, 0)

    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }

    if (normalized) {
      this.#leader = normalized.spring
      this.#offset = normalized.offset
      this.#unsubLeader = normalized.spring.onUpdate(() => {
        this.#setTarget(this.#leader!.#target + this.#leader!.#motion.position + this.#offset)
      })
    }
  }

  get target(): number {
    return this.#target
  }

  set target(value: SpringTarget) {
    if (typeof value === 'number') {
      this.#unfollow()
      this.#setTarget(value)
    } else {
      const normalized = normalizeTarget(value)!
      this.#follow(normalized.spring, normalized.offset)
    }
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

  set config(value: SpringConfig | null) {
    if (value) {
      if (this.#leader && !this.#ownsConfig) {
        // Fork: create own config so we don't mutate the leader's
        this.#ownsConfig = true
        this.#config = new SpringConfig({
          tension: value.tension,
          damping: value.damping,
          mass: value.mass,
          precision: value.precision,
        })
        this.#motion.configure(this.#config)
      } else {
        SpringConfig.assign(this.#config, value)
      }
      this.#motions.add(this.#motion)
    } else if (this.#ownsConfig) {
      this.#ownsConfig = false
      this.#config = this.#leader ? this.#leader.#config : SpringConfig.default
      this.#motion.configure(this.#config)
      this.#motions.add(this.#motion)
    }
  }

  get timeRemaining() {
    return this.#motion.timeRemaining
  }

  get isResting() {
    return this.#motion.isResting
  }

  jumpTo(value: number) {
    this.#target = value
    this.#motion.position = 0
    this.#motion.velocity = 0
    this.#motion.tick(0)
  }

  dispose() {
    if (this.#unsubLeader) {
      this.#unsubLeader()
      this.#unsubLeader = null
    }
    this.#motions.remove(this.#motion)
    this.#motion.dispose()
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

  #setTarget(value: number) {
    if (value !== this.#target) {
      this.#motions.add(this.#motion)
      const rawValue = this.#target + this.#motion.position
      this.#target = value
      this.#motion.position = rawValue - this.#target
      this.#motion.tick(0)
    }
  }

  #follow(leader: Spring, offset: number) {
    if (this.#unsubLeader) {
      this.#unsubLeader()
    }

    this.#leader = leader
    this.#offset = offset

    if (!this.#ownsConfig) {
      this.#config = leader.#config
      this.#motion.configure(this.#config)
    }

    this.#unsubLeader = leader.onUpdate(() => {
      this.#setTarget(this.#leader!.#target + this.#leader!.#motion.position + this.#offset)
    })

    this.#setTarget(leader.#target + leader.#motion.position + offset)
  }

  #unfollow() {
    if (!this.#leader) return

    this.#unsubLeader!()
    this.#unsubLeader = null
    this.#leader = null
    this.#offset = 0

    if (!this.#ownsConfig) {
      this.#ownsConfig = true
      this.#config = new SpringConfig({
        tension: this.#config.tension,
        damping: this.#config.damping,
        mass: this.#config.mass,
        precision: this.#config.precision,
      })
      this.#motion.configure(this.#config)
    }
  }
}
