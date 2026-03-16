import { invariant } from './util.ts'

// ── Input shapes ──────────────────────────────────────────────────────

interface BaseOptions {
  mass?: number | undefined
  /** Precision for resting threshold. Defaults to 2. */
  precision?: number | undefined
}

/** Group 1: Direct physics. */
interface DirectOptions extends BaseOptions {
  tension: number
  damping: number
}

/** Group 2a: Tension + dampingRatio, derive damping. */
interface TensionRatioOptions extends BaseOptions {
  tension: number
  dampingRatio: number
}

/** Group 2b: Damping + dampingRatio, derive tension. */
interface DampingRatioOptions extends BaseOptions {
  damping: number
  dampingRatio: number
}

/** Group 2c: Tension + damping + dampingRatio, derive mass. */
interface TensionDampingRatioOptions extends BaseOptions {
  tension: number
  damping: number
  dampingRatio: number
}

/** Group 3: Duration-based. */
interface DurationOptions extends BaseOptions {
  dampingRatio: number
  /** Settling time in milliseconds. */
  duration: number
  /** Reference displacement. Defaults to 1. */
  displacement?: number | undefined
}

interface TensionDurationOptions extends DurationOptions {
  tension: number
}

interface DampingDurationOptions extends DurationOptions {
  damping: number
}

export type SpringOptions =
  | DirectOptions
  | TensionRatioOptions
  | DampingRatioOptions
  | TensionDampingRatioOptions
  | DurationOptions
  | TensionDurationOptions
  | DampingDurationOptions

// ── SpringConfig ─────────────────────────────────────────────────────

/**
 * Immutable spring configuration. Resolves any valid input shape into
 * the canonical (mass, tension, damping) triple plus derived physics
 * and precision values.
 *
 * Input shapes:
 *   1. { tension, damping }               — direct
 *   2. { tension, dampingRatio }          — derive damping
 *   3. { damping, dampingRatio }          — derive tension
 *   4. { tension, damping, dampingRatio } — derive mass
 *   5. { dampingRatio, duration }         — derive all
 *   6. { tension, dampingRatio, duration }  — derive damping
 *   7. { damping, dampingRatio, duration }  — derive tension
 *
 * Mass is always optional and defaults to 1.
 * Duration-based configs accept an optional `displacement` (defaults to 1)
 * and `precision` (defaults to 2).
 */
export class SpringConfig {
  readonly mass: number
  readonly tension: number
  readonly damping: number
  readonly precision: number

  readonly naturalFrequency: number
  readonly criticalDamping: number
  readonly dampingRatio: number

  readonly precisionMultiplier: number
  readonly restingMagnitude: number

  constructor(input: SpringOptions) {
    const raw = input as unknown as Record<string, number | undefined>

    const mass = raw.mass
    const tension = raw.tension
    const damping = raw.damping
    const dampingRatio = raw.dampingRatio
    const duration = raw.duration !== undefined ? raw.duration / 1000 : undefined
    const displacement = raw.displacement ?? 1
    const precision = raw.precision ?? 2

    // Validate individual values
    if (mass !== undefined) invariant(mass > 0, 'Mass must be greater than 0')
    if (tension !== undefined) invariant(tension > 0, 'Tension must be greater than 0')
    if (damping !== undefined) invariant(damping >= 0, 'Damping must be greater than or equal to 0')
    if (dampingRatio !== undefined)
      invariant(dampingRatio >= 0, 'Damping ratio must be greater than or equal to 0')
    if (duration !== undefined) invariant(duration > 0, 'Duration must be greater than 0')
    invariant(displacement !== 0, 'Displacement must not be 0')
    invariant(precision > 0, 'Precision must be greater than 0')

    this.precision = precision
    this.precisionMultiplier = 10 ** precision
    this.restingMagnitude = 1 / this.precisionMultiplier

    const hasM = mass !== undefined
    const hasK = tension !== undefined
    const hasC = damping !== undefined
    const hasZ = dampingRatio !== undefined
    const hasT = duration !== undefined

    // ── Group 1: Direct ─────────────────────────────────────────────
    if (hasK && hasC && !hasZ && !hasT) {
      this.mass = mass ?? 1
      this.tension = tension
      this.damping = damping
    }
    // ── Group 2: Direct + dampingRatio ──────────────────────────────
    else if (hasK && hasZ && !hasC && !hasT) {
      this.mass = mass ?? 1
      this.tension = tension
      this.damping = 2 * dampingRatio * Math.sqrt(this.mass * tension)
    } else if (hasC && hasZ && !hasK && !hasT) {
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 to derive tension')
      this.mass = mass ?? 1
      this.tension = damping ** 2 / (4 * dampingRatio ** 2 * this.mass)
      this.damping = damping
    } else if (hasK && hasC && hasZ && !hasT) {
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 to derive mass')
      this.mass = damping ** 2 / (4 * dampingRatio ** 2 * tension)
      this.tension = tension
      this.damping = damping
    }
    // ── Group 3: Duration-based ─────────────────────────────────────
    else if (hasZ && hasT) {
      const threshold = this.restingMagnitude
      const x0 = Math.abs(displacement)

      invariant(x0 > threshold, 'displacement must be greater than the precision threshold')

      let sigmaCoeff: number
      if (dampingRatio < 1) {
        sigmaCoeff = dampingRatio
      } else if (dampingRatio === 1) {
        sigmaCoeff = 1
      } else {
        sigmaCoeff = dampingRatio - Math.sqrt(dampingRatio ** 2 - 1)
      }

      invariant(sigmaCoeff > 0, 'dampingRatio must be > 0 for duration-based config')

      const wn = (2 * Math.log(x0 / threshold)) / (sigmaCoeff * duration)

      if (!hasK && !hasC) {
        this.mass = mass ?? 1
        this.tension = wn ** 2 * this.mass
        this.damping = 2 * dampingRatio * this.mass * wn
      } else if (hasK && !hasM && !hasC) {
        this.mass = tension / wn ** 2
        this.tension = tension
        this.damping = 2 * dampingRatio * this.mass * wn
      } else if (hasC && !hasM && !hasK) {
        this.mass = damping / (2 * dampingRatio * wn)
        this.tension = wn ** 2 * this.mass
        this.damping = damping
      } else {
        throw new Error('Invalid spring config: provide one of the supported input shapes.')
      }
    } else {
      throw new Error('Invalid spring config: provide one of the supported input shapes.')
    }

    this.naturalFrequency = Math.sqrt(this.tension / this.mass)
    this.criticalDamping = 2 * this.mass * this.naturalFrequency
    this.dampingRatio = this.damping / this.criticalDamping
  }
}

export function springConfig(input: SpringOptions): SpringConfig {
  return new SpringConfig(input)
}
