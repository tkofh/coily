import type { SpringConfig } from './config.ts'
import type { SolverSet } from './solver-set.ts'
import { Solver } from './solver.ts'

interface DisplacedSpringPosition {
  target?: number | undefined
  value?: number | undefined
}

export type SpringPosition = number | DisplacedSpringPosition

export class Spring {
  #target: number
  #config: SpringConfig
  readonly #solver: Solver
  readonly #solvers: SolverSet

  constructor(solvers: SolverSet, position: SpringPosition, config: SpringConfig) {
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
    this.#solver = new Solver(config, value - target, 0)
    this.#solvers = solvers

    if (!this.#solver.resting) {
      this.#solvers.add(this.#solver)
    }
  }

  get target() {
    return this.#target
  }

  set target(value: number) {
    if (value !== this.#target) {
      this.#solvers.add(this.#solver)

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
      this.#solvers.add(this.#solver)

      this.#solver.position = position
      this.#solver.tick(0)
    }
  }

  get velocity() {
    return this.#solver.velocity
  }

  set velocity(value: number) {
    this.#solvers.add(this.#solver)
    this.#solver.velocity = value
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

  get resting() {
    return this.#solver.resting
  }

  configure(config: SpringConfig) {
    this.#config = config
    this.#solver.configure(config)
    this.#solvers.add(this.#solver)
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

  dispose() {
    this.#solvers.remove(this.#solver)
    this.#solver.dispose()
  }
}
