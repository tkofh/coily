import type { SpringDefinition } from './config.ts'
import type { State } from './state.ts'

// Closed-form solutions of the damped spring equation, one class per
// damping regime. Each solver anchors its constants c1/c2 from the state
// at configure time and evaluates position and velocity at absolute time
// t from that anchor — no numerical integration, so error never
// accumulates. `configure()` with no argument re-anchors at the current
// state after an external write; with a config it also adopts the
// config's constants.
//
// A config whose `arrival` multiplier is not 1 adds one more anchor-time
// output: the first strictly future time the position crosses 0. `tick`
// splits at that time — it evaluates there, writes position as an exact
// 0, scales velocity by the multiplier, and re-anchors — then spends
// what remains of the step from the new anchor. Rest reached at a
// crossing ends the tick with the state held for `Motion` to snap.

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

    if (this.#arrival === 1) {
      this.#crossing = Infinity
    } else {
      // Zeros of c1*cos(wd*t) + c2*sin(wd*t) fall at wd*t = atan2(-c1, c2)
      // (mod pi); the first lies in (0, pi]. An anchor on the target
      // (c1 = 0) yields pi — the return crossing — so a spring flung from
      // its target departs before arrival applies.
      let theta = Math.atan2(-this.#c1, this.#c2) % Math.PI
      if (theta <= 0) theta += Math.PI
      this.#crossing = theta / this.#dampedFrequency
    }
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
    // The crossing is x = 0 by construction; write it exactly rather than
    // keeping evaluation residue.
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

    if (this.#arrival === 1) {
      this.#crossing = Infinity
    } else {
      // (c1 + c2*t) has one root, -c1/c2: a strictly future crossing only
      // when velocity opposes displacement hard enough to punch through.
      // NaN (an anchor at rest) compares false into Infinity.
      const t = -this.#c1 / this.#c2
      this.#crossing = t > 0 ? t : Infinity
    }
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
    // The crossing is x = 0 by construction; write it exactly rather than
    // keeping evaluation residue.
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

/** dampingRatio > 1: slow non-oscillating decay, x(t) = exp(-sigma*t) * (c1*sinh(wd*t) + c2*cosh(wd*t)) / wd. */
export class OverdampedSolver {
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
      this.#dampedFrequency = config.naturalFrequency * Math.sqrt(config.dampingRatio ** 2 - 1)
      this.#arrival = config.arrival
    }
    this.#t = 0
    this.#c1 = this.#state.velocity + this.#decayRate * this.#state.position
    this.#c2 = this.#state.position * this.#dampedFrequency

    if (this.#arrival === 1) {
      this.#crossing = Infinity
    } else {
      // c1*sinh(wd*t) + c2*cosh(wd*t) crosses zero where tanh(wd*t) =
      // -c2/c1: a strictly future root only when the velocity term
      // dominates with opposing sign. atanh yields NaN or a non-positive
      // value otherwise, comparing false into Infinity.
      const theta = Math.atanh(-this.#c2 / this.#c1)
      this.#crossing = theta > 0 ? theta / this.#dampedFrequency : Infinity
    }
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
    // The crossing is x = 0 by construction; write it exactly rather than
    // keeping evaluation residue.
    this.#state.position = 0
    this.#state.velocity *= this.#arrival
    this.configure()
  }

  #evaluate() {
    const decay = Math.exp(-this.#decayRate * this.#t)
    const decayVelocity = -this.#decayRate * decay

    // sinh/cosh overflow to Infinity near 710, where the decay factor has
    // underflowed to 0 and their product would be NaN. sigma > wd in the
    // overdamped regime, so by wd*t = 300 the product is far below any
    // resting threshold and freezing the hyperbolic term is invisible.
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
