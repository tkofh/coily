import type { Scheduler } from './scheduler'
import { Solver } from './solver'
import { invariant } from './util'

interface SpringOptions {
  mass: number
  tension: number
  damping: number
  target: number
  value?: number
  precsiion?: number
}

export class Spring {
  #target: number
  #solver: Solver
  #scheduler: Scheduler

  #optimisticTarget: number

  constructor(scheduler: Scheduler, options: SpringOptions) {
    invariant(options.mass > 0, 'Mass must be greater than 0')
    invariant(options.tension > 0, 'Tension must be greater than 0')
    invariant(
      options.damping >= 0,
      'Damping must be greater than or equal to 0',
    )
    invariant(
      options.precsiion === undefined || options.precsiion > 0,
      'Precision must be greater than 0',
    )

    this.#target = options.target

    this.#solver = new Solver({
      mass: options.mass,
      tension: options.tension,
      damping: options.damping,
      position: options.target + (options.value ?? 0),
      velocity: 0,
      precision: options.precsiion ?? 2,
    })
    this.#scheduler = scheduler

    this.#optimisticTarget = this.#target

    if (!this.#solver.resting) {
      this.#scheduler.add(this.#solver)
    }
  }

  get target() {
    return this.#optimisticTarget
  }

  set target(value: number) {
    if (value !== this.#optimisticTarget) {
      this.#optimisticTarget = value
      this.#scheduler.once(() => {
        if (!this.#scheduler.has(this.#solver)) {
          this.#scheduler.add(this.#solver)
        }

        const currentValue = this.value
        this.#target = this.#optimisticTarget
        this.#solver.position = currentValue - this.#target
      })
    }
  }

  get value() {
    return this.#target + this.#solver.position
  }

  set value(value: number) {
    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.position = this.#target - value
  }

  get velocity() {
    return this.#solver.velocity
  }

  set velocity(value: number) {
    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.velocity = value
  }

  get mass() {
    return this.#solver.mass
  }

  set mass(value: number) {
    invariant(value > 0, 'Mass must be greater than 0')

    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.mass = value
  }

  get tension() {
    return this.#solver.tension
  }

  set tension(value: number) {
    invariant(value > 0, 'Tension must be greater than 0')

    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.tension = value
  }

  get damping() {
    return this.#solver.damping
  }

  set damping(value: number) {
    invariant(value >= 0, 'Damping must be greater than or equal to 0')

    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.damping = value
  }

  get precision() {
    return this.#solver.precision
  }

  set precision(value: number) {
    invariant(value > 0, 'Precision must be greater than 0')

    if (!this.#scheduler.has(this.#solver)) {
      this.#scheduler.add(this.#solver)
    }

    this.#solver.precision = value
  }

  get resting() {
    return this.#solver.resting
  }
}
