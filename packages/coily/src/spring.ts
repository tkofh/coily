import type { SpringConfig } from './config.ts'
import type { MotionSet } from './motion.ts'
import { SpringMotion } from './spring-motion.ts'

interface DisplacedSpringPosition {
  target?: number | undefined
  value?: number | undefined
}

export type SpringPosition = number | DisplacedSpringPosition

export class Spring {
  #target: number
  #config: SpringConfig
  readonly #motion: SpringMotion
  readonly #motions: MotionSet

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

    this.#target = target
    this.#config = config
    this.#motion = new SpringMotion(config, value - target, 0)
    this.#motions = motions

    if (!this.#motion.isResting) {
      this.#motions.add(this.#motion)
    }
  }

  get target() {
    return this.#target
  }

  set target(value: number) {
    if (value !== this.#target) {
      this.#motions.add(this.#motion)

      const currentValue = this.value
      this.#target = value
      this.#motion.position = currentValue - this.#target
      this.#motion.tick(0)
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
    this.#config = config
    this.#motion.configure(config)
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
}
