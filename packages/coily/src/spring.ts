import type { Scheduler } from './scheduler'
import { Solver } from './solver'
import { invariant } from './util'

export interface SpringOptions {
  /**
   * The mass of the spring
   *
   * must be greater than 0
   */
  mass: number
  /**
   * The tension of the spring
   *
   * must be greater than 0
   */
  tension: number
  /**
   * The damping of the spring
   *
   * must be greater than or equal to 0
   */
  damping: number
  /**
   * The target of the spring
   *
   * defaults to 0
   */
  target?: number
  /**
   * The current value of the spring
   *
   * defaults to the target
   */
  value?: number
  /**
   * The precision of the solver
   *
   * defaults to 2
   */
  precision?: number
}

export class Spring {
  #target: number
  readonly #solver: Solver
  readonly #scheduler: Scheduler

  constructor(scheduler: Scheduler, options: SpringOptions) {
    invariant(options.mass > 0, 'Mass must be greater than 0')
    invariant(options.tension > 0, 'Tension must be greater than 0')
    invariant(
      options.damping >= 0,
      'Damping must be greater than or equal to 0',
    )
    invariant(
      options.precision === undefined || options.precision > 0,
      'Precision must be greater than 0',
    )

    this.#target = options.target ?? options.value ?? 0

    this.#solver = new Solver({
      mass: options.mass,
      tension: options.tension,
      damping: options.damping,
      position: (options.value ?? this.#target) - this.#target,
      velocity: 0,
      precision: options.precision ?? 2,
    })
    this.#scheduler = scheduler

    if (!this.#solver.resting) {
      this.#scheduler.add(this.#solver)
    }
  }

  get target() {
    return this.#target
  }

  set target(value: number) {
    if (value !== this.#target) {
      if (!this.#scheduler.has(this.#solver)) {
        this.#scheduler.add(this.#solver)
      }

      const currentValue = this.value
      this.#target = value
      this.#solver.position = currentValue - this.#target
      this.#solver.tick(0)
    }
  }

  get value() {
    return this.#target + this.#solver.position
  }

  set value(value: number) {
    const position = value - this.#target
    if (position !== this.#solver.position) {
      if (!this.#scheduler.has(this.#solver)) {
        this.#scheduler.add(this.#solver)
      }

      this.#solver.position = position
      this.#solver.tick(0)
    }
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

  onUpdate(callback: () => void) {
    return this.#solver.onUpdate(callback)
  }

  onStart(callback: () => void) {
    return this.#solver.onStart(callback)
  }

  onStop(callback: () => void) {
    return this.#solver.onStop(callback)
  }

  jumpTo(value: number) {
    this.#target = value
    this.#solver.position = 0
    this.#solver.velocity = 0
    this.#solver.tick(0)
  }
}
