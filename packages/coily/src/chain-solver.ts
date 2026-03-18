import type { SpringConfig } from './config.ts'
import type { ChainState } from './chain-state.ts'

/**
 * Analytical chain solver for underdamped springs (max 4 links).
 *
 * Each link k's displacement from its moving target has the form:
 *
 *   qₖ(t) = e^(-αt) · Pₖ(t) · cos(ωd·t) + e^(-αt) · Qₖ(t) · sin(ωd·t)
 *
 * where Pₖ and Qₖ are polynomials of degree k.
 *
 * The ODE for link k driven by link k-1:
 *   qₖ'' + 2α·qₖ' + ωₙ²·qₖ = ωₙ²·qₖ₋₁(t)
 *
 * Since the forcing shares eigenvalues with the homogeneous solution (resonance),
 * each successive link gains one power of t.
 *
 * The particular solution for a complex forcing term C·tʲ·e^(s₀t) at resonance is:
 *   C · t^(j+1) / ((j+1) · P'(s₀)) · e^(s₀t)
 *
 * where P'(s₀) = 2iω. Each tʲ term contributes independently (no cross-talk),
 * so the recurrence for particular solution coefficients is:
 *   a[j+1] = -ωₙ² · prevB[j] / (2ω(j+1))
 *   b[j+1] =  ωₙ² · prevA[j] / (2ω(j+1))
 *
 * The j=0 (homogeneous) coefficients are then set by initial conditions.
 */

const MAX_LINKS = 4

export class UnderdampedChainSolver {
  readonly #state: ChainState
  readonly #count: number
  #alpha = 0
  #omega = 0
  #t = 0

  readonly #a: number[][] = []
  readonly #b: number[][] = []

  constructor(state: ChainState, count: number) {
    if (count < 1 || count > MAX_LINKS) {
      throw new Error(`Chain length must be between 1 and ${MAX_LINKS}`)
    }
    this.#state = state
    this.#count = count

    for (let k = 0; k < count; k++) {
      this.#a.push(new Array(k + 1).fill(0))
      this.#b.push(new Array(k + 1).fill(0))
    }
  }

  configure(config: SpringConfig) {
    this.#alpha = config.dampingRatio * config.naturalFrequency
    this.#omega = config.naturalFrequency * Math.sqrt(1 - config.dampingRatio ** 2)
    this.#t = 0

    const alpha = this.#alpha
    const omega = this.#omega

    const s0 = this.#state.get(0)
    this.#a[0]![0] = s0.position
    this.#b[0]![0] = (s0.velocity + alpha * s0.position) / omega

    for (let k = 1; k < this.#count; k++) {
      this.#solveLink(k, config)
    }
  }

  #solveLink(k: number, config: SpringConfig) {
    const alpha = this.#alpha
    const omega = this.#omega
    const wn2 = config.naturalFrequency ** 2

    const prevA = this.#a[k - 1]!
    const prevB = this.#b[k - 1]!
    const a = this.#a[k]!
    const b = this.#b[k]!

    for (let j = 0; j < k; j++) {
      const denom = 2 * omega * (j + 1)
      a[j + 1] = -wn2 * prevB[j]! / denom
      b[j + 1] = wn2 * prevA[j]! / denom
    }

    const sk = this.#state.get(k)
    a[0] = sk.position
    b[0] = (sk.velocity + alpha * sk.position - (a[1] ?? 0)) / omega
  }

  tick(dt: number) {
    this.#t += dt

    const t = this.#t
    const alpha = this.#alpha
    const omega = this.#omega
    const decay = Math.exp(-alpha * t)
    const decayVelocity = -alpha * decay
    const cos = Math.cos(omega * t)
    const sin = Math.sin(omega * t)

    for (let k = 0; k < this.#count; k++) {
      const a = this.#a[k]!
      const b = this.#b[k]!

      let polyA = 0
      let polyB = 0
      let polyAPrime = 0
      let polyBPrime = 0
      for (let j = k; j >= 0; j--) {
        if (j < k) {
          polyAPrime = polyAPrime * t + polyA
          polyBPrime = polyBPrime * t + polyB
        }
        polyA = polyA * t + a[j]!
        polyB = polyB * t + b[j]!
      }

      const oscillation = polyA * cos + polyB * sin
      const oscillationVelocity =
        (polyAPrime * cos + polyBPrime * sin) +
        (-polyA * omega * sin + polyB * omega * cos)

      const sk = this.#state.get(k)
      sk.position = decay * oscillation
      sk.velocity = decayVelocity * oscillation + decay * oscillationVelocity
    }
  }
}
