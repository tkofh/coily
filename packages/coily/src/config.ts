import { invariant } from './util.ts'

/**
 * A spring's instantaneous motion, measured relative to its target.
 * `SpringDefinition.computeTimeRemaining` takes one; build it from a live
 * spring as `{ position: spring.value - spring.target, velocity: spring.velocity }`.
 */
export interface SpringState {
  /** Displacement from the target in value units. 0 means at the target. */
  readonly position: number
  /** Rate of change of the displacement, in value units per second. */
  readonly velocity: number
}

interface BaseOptions {
  /**
   * Decimal places of the resting threshold. A spring rests once its
   * remaining motion cannot reach half a unit in the last place —
   * `0.5 * 10^-precision`, or 0.005 at the default.
   *
   * Values are never rounded; precision only decides rest. See
   * https://github.com/tkofh/coily/blob/main/PRECISION.md.
   *
   * @default 2
   */
  readonly precision?: number | undefined
}

interface WithMass {
  /**
   * Mass of the moving value. Heavier springs accelerate more slowly and
   * carry more momentum through the target. Must be greater than 0.
   * @default 1
   */
  readonly mass?: number | undefined
}

interface WithoutMass {
  /**
   * Mass is derived from the other parameters in this input shape
   * and cannot be provided.
   */
  readonly mass?: undefined
}

interface WithTension {
  /**
   * Spring stiffness. Higher tension pulls toward the target harder,
   * making the whole motion faster. Must be greater than 0.
   */
  readonly tension: number
}

interface WithDamping {
  /**
   * Friction strength. Higher damping bleeds off velocity faster and
   * reduces bounce; at 0 the spring oscillates forever. Must be greater
   * than or equal to 0.
   */
  readonly damping: number
}

interface WithDampingRatio {
  /**
   * Damping as a fraction of critical damping — the character of the
   * motion, independent of its speed. Below 1 the spring overshoots and
   * bounces. At 1 it settles as fast as possible without overshooting.
   * Above 1 it settles slower, still without overshooting. At 0 it never
   * settles. Must be greater than or equal to 0.
   */
  readonly dampingRatio: number
}

interface WithBounce {
  /**
   * Bounciness, converted to a damping ratio as `1 - bounce`. 0 settles
   * as fast as possible without overshooting. Positive values overshoot
   * and bounce; 1, maximum bounce, is clamped just short of undamped so
   * the spring still settles. Negative values settle without bounce, more
   * slowly. Must be between -1 and 1.
   */
  readonly bounce: number
}

interface WithDuration {
  /**
   * Target settle time in milliseconds. The spring is tuned so its motion
   * decays into the resting threshold within this time, assuming it
   * starts `displacement` away from the target. Actual rest lands at or
   * before the requested duration. Must be greater than 0.
   */
  readonly duration: number
}

interface WithDisplacement {
  /**
   * The initial displacement the duration tuning assumes. Set it to your
   * animation's range — 300 when animating 0 to 300 — so the settle
   * timing holds; timing skews as the real displacement diverges from
   * this value. Must not be 0.
   * @default 1
   */
  readonly displacement?: number | undefined
}

interface DirectOptions extends BaseOptions, WithMass, WithTension, WithDamping {}
interface TensionRatioOptions extends BaseOptions, WithMass, WithTension, WithDampingRatio {}
interface TensionBounceOptions extends BaseOptions, WithMass, WithTension, WithBounce {}
interface DampingRatioOptions extends BaseOptions, WithMass, WithDamping, WithDampingRatio {}
interface DampingBounceOptions extends BaseOptions, WithMass, WithDamping, WithBounce {}
interface TensionDampingRatioOptions
  extends BaseOptions, WithoutMass, WithTension, WithDamping, WithDampingRatio {}
interface TensionDampingBounceOptions
  extends BaseOptions, WithoutMass, WithTension, WithDamping, WithBounce {}
interface DurationOptions
  extends BaseOptions, WithMass, WithDampingRatio, WithDuration, WithDisplacement {}
interface BounceDurationOptions
  extends BaseOptions, WithMass, WithBounce, WithDuration, WithDisplacement {}
interface TensionDurationOptions
  extends BaseOptions, WithoutMass, WithTension, WithDampingRatio, WithDuration, WithDisplacement {}
interface TensionBounceDurationOptions
  extends BaseOptions, WithoutMass, WithTension, WithBounce, WithDuration, WithDisplacement {}
interface DampingDurationOptions
  extends BaseOptions, WithoutMass, WithDamping, WithDampingRatio, WithDuration, WithDisplacement {}
interface DampingBounceDurationOptions
  extends BaseOptions, WithoutMass, WithDamping, WithBounce, WithDuration, WithDisplacement {}

/** Every option key accepted by at least one `defineSpring` input shape. */
export type SpringOptionKeys =
  | 'mass'
  | 'tension'
  | 'damping'
  | 'dampingRatio'
  | 'bounce'
  | 'duration'
  | 'displacement'
  | 'precision'

/**
 * Marks every option key foreign to `T` as "absent or undefined", so mixing
 * properties from different input shapes fails to type-check instead of
 * silently resolving to an unintended shape at runtime.
 */
type Exact<T> = T & { [K in Exclude<SpringOptionKeys, keyof T>]?: undefined }

/**
 * Every input `defineSpring` accepts: one of the documented parameter
 * combinations, exactly as written — keys from different combinations
 * don't mix.
 */
export type SpringDefinitionOptions =
  | Exact<DirectOptions>
  | Exact<TensionRatioOptions>
  | Exact<TensionBounceOptions>
  | Exact<DampingRatioOptions>
  | Exact<DampingBounceOptions>
  | Exact<TensionDampingRatioOptions>
  | Exact<TensionDampingBounceOptions>
  | Exact<DurationOptions>
  | Exact<BounceDurationOptions>
  | Exact<TensionDurationOptions>
  | Exact<TensionBounceDurationOptions>
  | Exact<DampingDurationOptions>
  | Exact<DampingBounceDurationOptions>

/**
 * Immutable, resolved spring parameters. Whatever `defineSpring` input
 * shape produced it, a config carries concrete `mass`, `tension`,
 * `damping`, and `precision`, plus the quantities derived from them.
 * Instances are frozen and safe to share between springs; to change a
 * spring's behavior, assign a new config via `spring.config`.
 */
export class SpringDefinition {
  /** The config for springs created without one: critically damped, settling in about 500ms. */
  static readonly default = new SpringDefinition({ dampingRatio: 1, duration: 500 })

  /** Mass of the moving value, as provided or derived. */
  readonly mass: number
  /** Spring stiffness, as provided or derived. */
  readonly tension: number
  /** Friction strength, as provided or derived. */
  readonly damping: number
  /** Decimal places of the resting threshold — see `restingMagnitude`. */
  readonly precision: number

  /** Oscillation rate with no damping: `sqrt(tension / mass)`, in radians per second. */
  readonly naturalFrequency: number
  /** The damping at which bounce disappears: `2 * mass * naturalFrequency`. */
  readonly criticalDamping: number
  /**
   * `damping / criticalDamping`. Below 1 the spring overshoots and
   * bounces, at 1 it settles fastest without overshooting, above 1 it
   * settles slower.
   */
  readonly dampingRatio: number

  /** Resting threshold in value units: half a unit in the last `precision` place. */
  readonly restingMagnitude: number

  constructor(input: SpringDefinitionOptions) {
    const raw = input as unknown as Record<string, number | undefined>

    const mass = raw.mass
    const tension = raw.tension
    const damping = raw.damping
    const bounce = raw.bounce
    const duration = raw.duration !== undefined ? raw.duration / 1000 : undefined
    const displacement = raw.displacement ?? 1
    const precision = raw.precision ?? 2

    // Every provided option must be a finite number before its own range
    // check: comparisons reject NaN on their own, but let infinities
    // through to poison the derived parameters.
    for (const key of Object.keys(raw)) {
      const value = raw[key]
      if (value !== undefined) {
        invariant(Number.isFinite(value), () => `Invalid ${key}: expected a finite number`)
      }
    }

    // Validate individual values
    if (mass !== undefined) invariant(mass > 0, 'Mass must be greater than 0')
    if (tension !== undefined) invariant(tension > 0, 'Tension must be greater than 0')
    if (damping !== undefined) invariant(damping >= 0, 'Damping must be greater than or equal to 0')
    if (bounce !== undefined)
      invariant(bounce >= -1 && bounce <= 1, 'Bounce must be between -1 and 1')

    invariant(
      raw.dampingRatio === undefined || bounce === undefined,
      'Provide either dampingRatio or bounce, not both',
    )

    // Resolve bounce → dampingRatio
    // Clamp to a small epsilon so bounce=1 ("max bounce") still settles
    const dampingRatio =
      raw.dampingRatio ?? (bounce !== undefined ? Math.max(1e-4, 1 - bounce) : undefined)

    if (dampingRatio !== undefined)
      invariant(dampingRatio >= 0, 'Damping ratio must be greater than or equal to 0')
    if (duration !== undefined) invariant(duration > 0, 'Duration must be greater than 0')
    invariant(displacement !== 0, 'Displacement must not be 0')
    invariant(precision >= 0, 'Precision must be greater than or equal to 0')

    this.precision = precision
    this.restingMagnitude = 0.5 / 10 ** precision

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
      invariant(!hasM, 'mass is derived when tension, damping, and dampingRatio are all provided')
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 to derive mass')
      this.mass = damping ** 2 / (4 * dampingRatio ** 2 * tension)
      this.tension = tension
      this.damping = damping
    }
    // ── Group 3: Duration-based ─────────────────────────────────────
    else if (hasZ && hasT) {
      // Fixed threshold for duration derivation so precision doesn't affect spring physics.
      const threshold = 0.005
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
      } else if (hasK && !hasC) {
        invariant(!hasM, 'mass is derived in duration-based configs with tension')
        this.mass = tension / wn ** 2
        this.tension = tension
        this.damping = 2 * dampingRatio * this.mass * wn
      } else if (hasC && !hasK) {
        invariant(!hasM, 'mass is derived in duration-based configs with damping')
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

    Object.freeze(this)
  }

  /**
   * Estimates how long a spring with this config takes to come to rest
   * from `state`, in milliseconds.
   *
   * The estimate follows the motion's decay envelope with a 2x safety
   * margin, so actual rest usually lands earlier. Returns 0 when `state`
   * is already inside the resting threshold, and Infinity when the config
   * never settles (a `dampingRatio` of 0).
   */
  computeTimeRemaining(state: SpringState): number {
    const { position, velocity } = state

    // Effective initial amplitude: kinetic energy can convert into up to
    // |v| / wn of additional displacement.
    const a0 = Math.abs(position) + Math.abs(velocity) / this.naturalFrequency

    if (a0 <= this.restingMagnitude) return 0

    // Envelope decay rate sigma per regime: zeta * wn underdamped, wn
    // critically damped, and the slower eigenvalue
    // (zeta - sqrt(zeta^2 - 1)) * wn overdamped.
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

    // The envelope exp(-sigma * t) * a0 crosses the threshold at
    // t = ln(a0 / threshold) / sigma, doubled to cover the polynomial
    // terms of the critically damped solution.
    return ((2 * Math.log(a0 / this.restingMagnitude)) / sigma) * 1000
  }
}

/**
 * Creates a config from direct physical parameters: you set stiffness
 * and friction exactly.
 */
export function defineSpring(input: Exact<DirectOptions>): SpringDefinition
/**
 * Creates a config from stiffness and motion character. Damping is
 * derived as `2 * dampingRatio * sqrt(mass * tension)`.
 */
export function defineSpring(input: Exact<TensionRatioOptions>): SpringDefinition
/**
 * Creates a config from stiffness and bounciness. Damping is derived to
 * match the requested bounce, from -1 (no bounce, slow settle) to 1
 * (maximum bounce).
 */
export function defineSpring(input: Exact<TensionBounceOptions>): SpringDefinition
/**
 * Creates a config from friction and motion character. Tension is
 * derived as `damping^2 / (4 * dampingRatio^2 * mass)`; `dampingRatio`
 * must be greater than 0.
 */
export function defineSpring(input: Exact<DampingRatioOptions>): SpringDefinition
/**
 * Creates a config from friction and bounciness. Tension is derived to
 * match the requested bounce; `bounce` must be less than 1.
 */
export function defineSpring(input: Exact<DampingBounceOptions>): SpringDefinition
/**
 * Creates a config from all three physical knobs. Mass is derived as
 * `damping^2 / (4 * dampingRatio^2 * tension)` and cannot be provided;
 * `dampingRatio` must be greater than 0.
 */
export function defineSpring(input: Exact<TensionDampingRatioOptions>): SpringDefinition
/**
 * Creates a config from all three physical knobs. Mass is derived from
 * tension, damping, and the requested bounce, and cannot be provided;
 * `bounce` must be less than 1.
 */
export function defineSpring(input: Exact<TensionDampingBounceOptions>): SpringDefinition
/**
 * Tunes the spring to settle within `duration` milliseconds, with
 * `dampingRatio` setting the motion's character. Tension and damping are
 * both derived.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 *
 * @example
 * ```ts
 * // Tuned for a 300px move; rests within 750ms
 * defineSpring({ duration: 750, dampingRatio: 1, displacement: 300 })
 * ```
 */
export function defineSpring(input: Exact<DurationOptions>): SpringDefinition
/**
 * Tunes the spring to settle within `duration` milliseconds, with
 * `bounce` setting how oscillatory the settling motion is. Tension and
 * damping are both derived.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<BounceDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given stiffness to settle within `duration`
 * milliseconds. Mass is derived from tension and the computed natural
 * frequency, then damping from mass and `dampingRatio`; mass cannot be
 * provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<TensionDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given stiffness to settle within `duration`
 * milliseconds, with `bounce` setting how oscillatory the settling motion
 * is. Mass is derived from tension and the computed natural frequency,
 * and cannot be provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<TensionBounceDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given friction to settle within `duration`
 * milliseconds. Mass is derived from damping, `dampingRatio`, and the
 * computed natural frequency, then tension from mass; mass cannot be
 * provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<DampingDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given friction to settle within `duration`
 * milliseconds, with `bounce` setting how oscillatory the settling motion
 * is. Mass is derived from damping and the computed natural frequency,
 * and cannot be provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<DampingBounceDurationOptions>): SpringDefinition
export function defineSpring(input: SpringDefinitionOptions): SpringDefinition {
  return new SpringDefinition(input)
}
