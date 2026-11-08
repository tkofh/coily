import type { SpringDefinition } from './config.ts'
import type { State } from './state.ts'

// Closed-form solutions of the damped spring equation, one class per
// damping regime. `configure` anchors c1 and c2 at the current state, and
// `tick` evaluates at absolute time t since that anchor, so error never
// accumulates. Bare `configure()` re-anchors after an external write. With
// a config, it also adopts the config's constants.
//
// When `arrival` is not 1, anchoring also solves the first strictly future
// crossing of 0. `tick` splits there: it writes position exactly 0, scales
// velocity by `arrival`, re-anchors, and spends the rest of the step. A
// tick that rests at a crossing ends there, leaving `SpringMotion` to snap.

// First crossings, shared with `computeTimeRemaining` so the solvers and
// the estimate cannot disagree about when a motion reaches its target.
// Each takes the anchor constants of its regime's solver below.

/**
 * The first zero of c1*cos(u) + c2*sin(u) in (0, pi]: u = atan(-c1/c2),
 * moved up by pi when not positive. Not atan2(-c1, c2) reduced mod pi:
 * a root a hair past -pi rounds to -pi exactly, and the reduction then
 * loses it to a whole half period. An anchor on the target (c1 = 0)
 * yields pi, the return crossing.
 */
export function underdampedCrossingAngle(c1: number, c2: number): number {
  const u = Math.atan(-c1 / c2)
  return u > 0 ? u : u + Math.PI
}

/**
 * The root of c1 + c2*t in seconds when strictly future, else Infinity.
 * NaN (an anchor at rest) fails the test too.
 */
export function criticalCrossing(c1: number, c2: number): number {
  const t = -c1 / c2
  return t > 0 ? t : Infinity
}

/**
 * The u = wd*t where c1*sinh(u) + c2*cosh(u) crosses zero, tanh(u) =
 * -c2/c1, when strictly future: only when the velocity term dominates
 * with the opposite sign. Otherwise atanh yields NaN or <= 0, and the
 * result is Infinity.
 */
export function overdampedCrossingAngle(c1: number, c2: number): number {
  const u = Math.atanh(-c2 / c1)
  return u > 0 ? u : Infinity
}

/** dampingRatio < 1: decaying oscillation, x(t) = exp(-sigma*t) * (c1*cos(wd*t) + c2*sin(wd*t)). */
export class UnderdampedSolver {
  #state: State

  #dampedFrequency = 0
  #decayRate = 0
  #arrival = 1
  #t = 0
  #c1 = 0
  #c2 = 0
  #crossing = Infinity

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringDefinition) {
    if (config) {
      this.#decayRate = config.dampingRatio * config.naturalFrequency
      this.#dampedFrequency = config.naturalFrequency * Math.sqrt(1 - config.dampingRatio ** 2)
      this.#arrival = config.arrival
    }
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 =
      (this.#state.velocity + this.#decayRate * this.#state.position) / this.#dampedFrequency

    // A spring flung from its target crosses next on its return, so it
    // departs before arrival applies.
    this.#crossing =
      this.#arrival === 1
        ? Infinity
        : underdampedCrossingAngle(this.#c1, this.#c2) / this.#dampedFrequency
  }

  tick(dt: number) {
    let t = this.#t + dt
    while (t >= this.#crossing) {
      t -= this.#crossing
      this.#arrive()
      if (this.#state.isResting) return
    }
    this.#t = t
    this.#evaluate()
  }

  #arrive() {
    this.#t = this.#crossing
    this.#evaluate()
    // x = 0 by construction. Write it exactly, dropping evaluation residue.
    this.#state.position = 0
    this.#state.velocity *= this.#arrival
    this.configure()
  }

  #evaluate() {
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

/** dampingRatio = 1: fastest non-oscillating decay, x(t) = (c1 + c2*t) * exp(-wn*t). */
export class CriticallyDampedSolver {
  #state: State

  #naturalFrequency = 0
  #arrival = 1
  #t = 0
  #c1 = 0
  #c2 = 0
  #crossing = Infinity

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringDefinition) {
    if (config) {
      this.#naturalFrequency = config.naturalFrequency
      this.#arrival = config.arrival
    }
    this.#t = 0
    this.#c1 = this.#state.position
    this.#c2 = this.#state.velocity + this.#naturalFrequency * this.#state.position

    // Strictly future only when the velocity opposes the displacement
    // hard enough to punch through.
    this.#crossing = this.#arrival === 1 ? Infinity : criticalCrossing(this.#c1, this.#c2)
  }

  tick(dt: number) {
    let t = this.#t + dt
    while (t >= this.#crossing) {
      t -= this.#crossing
      this.#arrive()
      if (this.#state.isResting) return
    }
    this.#t = t
    this.#evaluate()
  }

  #arrive() {
    this.#t = this.#crossing
    this.#evaluate()
    // x = 0 by construction. Write it exactly, dropping evaluation residue.
    this.#state.position = 0
    this.#state.velocity *= this.#arrival
    this.configure()
  }

  #evaluate() {
    const decay = Math.exp(-this.#naturalFrequency * this.#t)
    const decayVelocity = -this.#naturalFrequency * decay

    const scale = this.#c1 + this.#c2 * this.#t
    const scaleVelocity = this.#c2

    this.#state.position = scale * decay
    this.#state.velocity = scaleVelocity * decay + decayVelocity * scale
  }
}

/** The `wd * t` past which overdamped motion evaluates only its slow mode. */
export const TAIL = 20

/** dampingRatio > 1: slow non-oscillating decay, x(t) = exp(-sigma*t) * (c1*sinh(wd*t) + c2*cosh(wd*t)) / wd. */
export class OverdampedSolver {
  #state: State

  #dampedFrequency = 0
  #decayRate = 0
  /** wd - sigma, negative. */
  #slowRate = 0
  #arrival = 1
  #t = 0
  #c1 = 0
  #c2 = 0
  #crossing = Infinity

  constructor(state: State) {
    this.#state = state
  }

  configure(config?: SpringDefinition) {
    if (config) {
      this.#decayRate = config.dampingRatio * config.naturalFrequency
      this.#dampedFrequency = config.naturalFrequency * Math.sqrt(config.dampingRatio ** 2 - 1)
      // Rationalized, since sigma^2 - wd^2 = wn^2: the plain difference
      // cancels to 0 near a ratio of 1e8 and freezes the spring.
      const wn = config.naturalFrequency
      this.#slowRate = -wn * (wn / (this.#decayRate + this.#dampedFrequency))
      this.#arrival = config.arrival
    }
    this.#t = 0
    this.#c1 = this.#state.velocity + this.#decayRate * this.#state.position
    this.#c2 = this.#state.position * this.#dampedFrequency

    this.#crossing =
      this.#arrival === 1
        ? Infinity
        : overdampedCrossingAngle(this.#c1, this.#c2) / this.#dampedFrequency
  }

  tick(dt: number) {
    let t = this.#t + dt
    while (t >= this.#crossing) {
      t -= this.#crossing
      this.#arrive()
      if (this.#state.isResting) return
    }
    this.#t = t
    this.#evaluate()
  }

  #arrive() {
    this.#t = this.#crossing
    this.#evaluate()
    // x = 0 by construction. Write it exactly, dropping evaluation residue.
    this.#state.position = 0
    this.#state.velocity *= this.#arrival
    this.configure()
  }

  #evaluate() {
    const wd = this.#dampedFrequency
    const wdt = wd * this.#t

    if (wdt > TAIL) {
      // Slow mode exp((wd - sigma) * t) plus fast mode exp(-(wd + sigma) * t).
      // Past TAIL the fast mode is under exp(-2 * TAIL) of the slow one,
      // below an ulp, so the slow mode alone is exact and never overflows
      // the way sinh and cosh do near 710. It decays at sigma - wd, about
      // wn / (2 * dampingRatio), so a heavy spring reaches TAIL still moving.
      const slowRate = this.#slowRate
      const position = ((this.#c1 + this.#c2) / (2 * wd)) * Math.exp(slowRate * this.#t)
      this.#state.position = position
      this.#state.velocity = slowRate * position
      return
    }

    // Below TAIL the hyperbolic form is exact and avoids the cancellation
    // the two-mode form has near critical damping, where wd is close to 0.
    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay
    const sinh = Math.sinh(wdt)
    const cosh = Math.cosh(wdt)

    const scale = this.#c1 * sinh + this.#c2 * cosh
    const scaleVelocity = this.#c1 * wd * cosh + this.#c2 * wd * sinh

    this.#state.position = (scale * decay) / wd
    this.#state.velocity = (scale * decayVelocity + scaleVelocity * decay) / wd
  }
}
