import { Emitter } from './emitter.ts'
import { State } from './state.ts'
import { invariant } from './util.ts'

export class Solver {
  #mass: number
  #tension: number
  #damping: number
  readonly #state: State

  #underdampedSolver: UnderdampedSolver | null = null
  #criticallyDampedSolver: CriticallyDampedSolver | null = null
  #overdampedSolver: OverdampedSolver | null = null
  #currentSolver: Solveable | null = null

  #naturalFrequency = 0
  #criticalDamping = 0
  #dampingRatio = 0

  #needsUpdate = false
  #needsReset = false

  readonly #emitter: Emitter

  constructor(
    mass: number,
    tension: number,
    damping: number,
    position: number,
    velocity: number,
    precision: number,
  ) {
    this.#mass = mass
    this.#tension = tension
    this.#damping = damping
    this.#state = new State(position, velocity, precision)
    this.#emitter = new Emitter()

    this.#updateSolver()
  }

  get mass() {
    return this.#mass
  }

  set mass(value: number) {
    this.#mass = value
    this.#needsUpdate = true
  }

  get tension() {
    return this.#tension
  }

  set tension(value: number) {
    this.#tension = value
    this.#needsUpdate = true
  }

  get damping() {
    return this.#damping
  }

  set damping(value: number) {
    this.#damping = value
    this.#needsUpdate = true
  }

  get position() {
    return this.#state.position
  }

  set position(value: number) {
    this.#state.position = value
    this.#needsReset = true

    if (!this.#state.resting) {
      this.#emitter.emit('start')
    }
  }

  get velocity() {
    return this.#state.velocity
  }

  set velocity(value: number) {
    this.#state.velocity = value
    this.#needsReset = true
  }

  get precision() {
    return this.#state.precision
  }

  set precision(value: number) {
    this.#state.precision = value
  }

  get resting() {
    return this.#state.resting
  }

  get naturalFrequency() {
    return this.#naturalFrequency
  }

  get criticalDamping() {
    return this.#criticalDamping
  }

  get dampingRatio() {
    return this.#dampingRatio
  }

  tick(dt: number, emit = true) {
    invariant(this.#currentSolver, 'Cannot tick a disposed solver')

    if (this.#needsUpdate) {
      this.#updateSolver()

      this.#needsUpdate = false
      this.#needsReset = true
    }
    if (this.#needsReset) {
      this.#currentSolver.reset()

      this.#needsReset = false
    }

    this.#currentSolver.tick(dt)

    if (emit) {
      this.#emitter.emit('update')

      if (this.#state.resting) {
        this.#emitter.emit('stop')
      }
    }
  }

  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  dispose() {
    this.#emitter.clear()
    this.#underdampedSolver = null
    this.#criticallyDampedSolver = null
    this.#overdampedSolver = null
    this.#currentSolver = null
  }

  #updateDerivedValues() {
    this.#naturalFrequency = Math.sqrt(this.#tension / this.#mass)
    this.#criticalDamping = 2 * this.#mass * this.#naturalFrequency
    this.#dampingRatio = this.#damping / this.#criticalDamping
  }

  #updateSolver() {
    this.#updateDerivedValues()

    if (this.dampingRatio < 1) {
      this.#underdampedSolver ||= new UnderdampedSolver(this, this.#state)

      this.#currentSolver = this.#underdampedSolver
    } else if (this.dampingRatio === 1) {
      this.#criticallyDampedSolver ||= new CriticallyDampedSolver(this, this.#state)

      this.#currentSolver = this.#criticallyDampedSolver
    } else {
      this.#overdampedSolver ||= new OverdampedSolver(this, this.#state)

      this.#currentSolver = this.#overdampedSolver
    }
  }
}

interface Solveable {
  reset: () => void
  tick: (dt: number) => void
}

class UnderdampedSolver implements Solveable {
  #solver: Solver
  #state: State

  #dampedFrequency!: number
  #decayRate!: number
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(solver: Solver, state: State) {
    this.#solver = solver
    this.#state = state

    this.reset()
  }

  reset() {
    this.#decayRate = this.#solver.dampingRatio * this.#solver.naturalFrequency
    this.#dampedFrequency =
      this.#solver.naturalFrequency * Math.sqrt(1 - this.#solver.dampingRatio ** 2)
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 =
      (this.#state.velocity + this.#decayRate * this.#state.position) / this.#dampedFrequency

    this.tick(0)
  }

  tick(dt: number) {
    this.#t += dt

    const sin = Math.sin(this.#dampedFrequency * this.#t)
    const cos = Math.cos(this.#dampedFrequency * this.#t)

    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay

    const oscillation = this.#c1 * cos + this.#c2 * sin
    const oscillationVelocity =
      -this.#c1 * this.#dampedFrequency * sin + this.#c2 * this.#dampedFrequency * cos

    this.#state.position = decay * oscillation
    this.#state.velocity = decay * oscillationVelocity + decayVelocity * oscillation
  }
}

class CriticallyDampedSolver implements Solveable {
  #solver: Solver
  #state: State

  #naturalFrequency!: number
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(solver: Solver, state: State) {
    this.#solver = solver
    this.#state = state

    this.reset()
  }

  reset() {
    this.#naturalFrequency = this.#solver.naturalFrequency
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 = this.#state.velocity + this.#naturalFrequency * this.#state.position

    this.tick(0)
  }

  tick(dt: number) {
    this.#t += dt

    const decay = Math.exp(-this.#naturalFrequency * this.#t)
    const decayVelocity = -this.#naturalFrequency * decay

    const scale = this.#c1 + this.#c2 * this.#t
    const scaleVelocity = this.#c2

    this.#state.position = scale * decay
    this.#state.velocity = scaleVelocity * decay + decayVelocity * scale
  }
}

class OverdampedSolver implements Solveable {
  #solver: Solver
  #state: State

  #dampedFrequency!: number
  #decayRate!: number
  #t = 0
  #c1 = 0
  #c2 = 0

  constructor(solver: Solver, state: State) {
    this.#solver = solver
    this.#state = state

    this.reset()
  }

  reset() {
    this.#decayRate = this.#solver.dampingRatio * this.#solver.naturalFrequency
    this.#dampedFrequency =
      this.#solver.naturalFrequency * Math.sqrt(this.#solver.dampingRatio ** 2 - 1)
    this.#t = 0
    this.#c1 = this.#state.velocity + this.#decayRate * this.#state.position
    this.#c2 = this.#state.position * this.#dampedFrequency
  }

  tick(dt: number) {
    this.#t += dt

    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay

    const clamped = Math.min(this.#dampedFrequency * this.#t, 300)

    const sinh = Math.sinh(clamped)
    const cosh = Math.cosh(clamped)

    const scale = this.#c1 * sinh + this.#c2 * cosh
    const scaleVelocity =
      this.#c1 * this.#dampedFrequency * cosh + this.#c2 * this.#dampedFrequency * sinh

    this.#state.position = (scale * decay) / this.#dampedFrequency
    this.#state.velocity = (scale * decayVelocity + scaleVelocity * decay) / this.#dampedFrequency
  }
}
