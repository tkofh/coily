import { invariant } from './util.ts'

type Writable<T> = { -readonly [K in keyof T]: T[K] }

export interface SpringState {
  readonly position: number
  readonly velocity: number
}

interface BaseOptions {
  /**
   * Mass of the spring system.
   * @default 1
   */
  mass?: number | undefined
  /**
   * Precision for resting threshold.
   * @default 2
   */
  precision?: number | undefined
}

interface WithTension {
  /**
   * Spring stiffness coefficient.
   * Must be greater than 0.
   */
  tension: number
}

interface WithDamping {
  /**
   * Viscous damping coefficient.
   * Must be greater than or equal to 0.
   */
  damping: number
}

interface WithDampingRatio {
  /**
   * Ratio of damping to critical damping (0 = undamped, 1 = critically damped).
   * Must be greater than or equal to 0.
   */
  dampingRatio: number
}

interface WithBounce {
  /**
   * Bounciness of the spring. Converted to dampingRatio as `1 - bounce`.
   * [-1, 1]
   */
  bounce: number
}

interface WithDuration {
  /**
   * Target settle duration in milliseconds.
   * Must be greater than 0.
   */
  duration: number
}

interface WithDisplacement {
  /**
   * Initial displacement used for duration-based envelope calculation.
   * @default 1
   */
  displacement?: number | undefined
}

interface DirectOptions extends BaseOptions, WithTension, WithDamping {}
interface TensionRatioOptions extends BaseOptions, WithTension, WithDampingRatio {}
interface TensionBounceOptions extends BaseOptions, WithTension, WithBounce {}
interface DampingRatioOptions extends BaseOptions, WithDamping, WithDampingRatio {}
interface DampingBounceOptions extends BaseOptions, WithDamping, WithBounce {}
interface TensionDampingRatioOptions
  extends BaseOptions, WithTension, WithDamping, WithDampingRatio {}
interface TensionDampingBounceOptions extends BaseOptions, WithTension, WithDamping, WithBounce {}
interface DurationOptions extends BaseOptions, WithDampingRatio, WithDuration, WithDisplacement {}
interface BounceDurationOptions extends BaseOptions, WithBounce, WithDuration, WithDisplacement {}
interface TensionDurationOptions
  extends BaseOptions, WithTension, WithDampingRatio, WithDuration, WithDisplacement {}
interface TensionBounceDurationOptions
  extends BaseOptions, WithTension, WithBounce, WithDuration, WithDisplacement {}
interface DampingDurationOptions
  extends BaseOptions, WithDamping, WithDampingRatio, WithDuration, WithDisplacement {}
interface DampingBounceDurationOptions
  extends BaseOptions, WithDamping, WithBounce, WithDuration, WithDisplacement {}

export type SpringOptions =
  | DirectOptions
  | TensionRatioOptions
  | TensionBounceOptions
  | DampingRatioOptions
  | DampingBounceOptions
  | TensionDampingRatioOptions
  | TensionDampingBounceOptions
  | DurationOptions
  | BounceDurationOptions
  | TensionDurationOptions
  | TensionBounceDurationOptions
  | DampingDurationOptions
  | DampingBounceDurationOptions

/**
 * Immutable spring configuration.
 */
export class SpringConfig {
  /** @internal Incremented by `SpringConfig.assign` to signal mutations. */
  #version = 0

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
    const bounce = raw.bounce
    const duration = raw.duration !== undefined ? raw.duration / 1000 : undefined
    const displacement = raw.displacement ?? 1
    const precision = raw.precision ?? 2

    // Validate individual values
    if (mass !== undefined) invariant(mass > 0, 'Mass must be greater than 0')
    if (tension !== undefined) invariant(tension > 0, 'Tension must be greater than 0')
    if (damping !== undefined) invariant(damping >= 0, 'Damping must be greater than or equal to 0')
    if (bounce !== undefined)
      invariant(bounce >= -1 && bounce <= 1, 'Bounce must be between -1 and 1')

    // Resolve bounce → dampingRatio
    // Clamp to a small epsilon so bounce=1 ("max bounce") still settles
    const dampingRatio =
      raw.dampingRatio ?? (bounce !== undefined ? Math.max(1e-4, 1 - bounce) : undefined)

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

  static version(config: SpringConfig) {
    return config.#version
  }

  static assign(target: SpringConfig, source: SpringConfig) {
    target.#version++
    const t = target as Writable<SpringConfig>
    t.mass = source.mass
    t.tension = source.tension
    t.damping = source.damping
    t.precision = source.precision
    t.naturalFrequency = source.naturalFrequency
    t.criticalDamping = source.criticalDamping
    t.dampingRatio = source.dampingRatio
    t.precisionMultiplier = source.precisionMultiplier
    t.restingMagnitude = source.restingMagnitude
  }

  /**
   * Analytically estimates the time remaining for a spring to come to rest,
   * given the current displacement and velocity.
   *
   * Uses the exponential decay envelope common to all three damping regimes.
   * The decay rate depends on the regime:
   * - Underdamped (ζ < 1): σ = ζωₙ
   * - Critically damped (ζ = 1): σ = ωₙ
   * - Overdamped (ζ > 1): σ = (ζ - √(ζ²-1))ωₙ  (the slower eigenvalue)
   *
   * The effective initial amplitude accounts for both displacement and velocity,
   * since kinetic energy can convert to additional displacement:
   *   A₀ = |x₀| + |v₀| / ωₙ
   *
   * Settling time: t = ln(A₀ / threshold) / σ, with a 2× safety factor
   * to account for polynomial terms in the critically damped solution.
   *
   * Returns the estimated time in milliseconds.
   */
  computeTimeRemaining(state: SpringState): number {
    const { position, velocity } = state

    const a0 = Math.abs(position) + Math.abs(velocity) / this.naturalFrequency

    if (a0 <= this.restingMagnitude) return 0

    let sigma: number
    if (this.dampingRatio < 1) {
      sigma = this.dampingRatio * this.naturalFrequency
    } else if (this.dampingRatio === 1) {
      sigma = this.naturalFrequency
    } else {
      sigma =
        (this.dampingRatio - Math.sqrt(this.dampingRatio * this.dampingRatio - 1)) *
        this.naturalFrequency
    }

    if (sigma <= 0) return Infinity

    return ((2 * Math.log(a0 / this.restingMagnitude)) / sigma) * 1000
  }
}

/**
 * Direct physical parameters. You control stiffness and friction exactly;
 * mass defaults to 1.
 */
export function defineSpring(input: DirectOptions): SpringConfig
/**
 * Tension sets the stiffness; dampingRatio controls oscillation character
 * (0 = undamped, 1 = critically damped, >1 = overdamped).
 * Damping is derived as `2 * dampingRatio * sqrt(mass * tension)`.
 */
export function defineSpring(input: TensionRatioOptions): SpringConfig
/**
 * Tension sets the stiffness; bounce controls how oscillatory the spring is,
 * from -1 (overdamped, no oscillation) to 1 (maximum bounce).
 * Damping is derived to match the requested bounciness.
 */
export function defineSpring(input: TensionBounceOptions): SpringConfig
/**
 * Damping is given directly; dampingRatio is used to derive tension
 * as `damping² / (4 * dampingRatio² * mass)`.
 * dampingRatio must be greater than 0.
 */
export function defineSpring(input: DampingRatioOptions): SpringConfig
/**
 * Damping is given directly; bounce controls how oscillatory the spring is.
 * Tension is derived to match the requested bounciness.
 * bounce must be less than 1.
 */
export function defineSpring(input: DampingBounceOptions): SpringConfig
/**
 * All three physical knobs specified — mass is derived
 * as `damping² / (4 * dampingRatio² * tension)`.
 * dampingRatio must be greater than 0.
 */
export function defineSpring(input: TensionDampingRatioOptions): SpringConfig
/**
 * All three physical knobs specified — mass is derived
 * from tension, damping, and the requested bounciness.
 * bounce must be less than 1.
 */
export function defineSpring(input: TensionDampingBounceOptions): SpringConfig
/**
 * Duration-based configuration. The spring is tuned so that its envelope
 * decays to the resting threshold within the given duration.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 * Tension and damping are both derived from dampingRatio and duration.
 */
export function defineSpring(input: DurationOptions): SpringConfig
/**
 * Duration-based configuration. The spring is tuned so that its envelope
 * decays to the resting threshold within the given duration.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 * Bounce controls how oscillatory the motion is while settling.
 * Tension and damping are both derived.
 */
export function defineSpring(input: BounceDurationOptions): SpringConfig
/**
 * Duration-based with a tension constraint. Mass is derived from tension
 * and the computed natural frequency; damping follows from mass and dampingRatio.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 */
export function defineSpring(input: TensionDurationOptions): SpringConfig
/**
 * Duration-based with a tension constraint. Bounce controls how oscillatory
 * the motion is while settling. Mass is derived from tension and the
 * computed natural frequency.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 */
export function defineSpring(input: TensionBounceDurationOptions): SpringConfig
/**
 * Duration-based with a damping constraint. Mass is derived from damping,
 * dampingRatio, and the computed natural frequency; tension follows from mass.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 */
export function defineSpring(input: DampingDurationOptions): SpringConfig
/**
 * Duration-based with a damping constraint. Bounce controls how oscillatory
 * the motion is while settling. Mass is derived from damping and the
 * computed natural frequency.
 * Duration assumes a displacement of 1 by default — provide `displacement`
 * to match your actual animation range for accurate timing.
 */
export function defineSpring(input: DampingBounceDurationOptions): SpringConfig
export function defineSpring(input: SpringOptions): SpringConfig {
  return new SpringConfig(input)
}
