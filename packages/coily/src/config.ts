import { invariant } from './util.ts'

/**
 * A spring's instantaneous motion, measured relative to its target.
 * `SpringDefinition.computeTimeRemaining` takes one. Build it from a live
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
   * remaining motion fits within `0.5 * 10^-precision` (0.005 at the
   * default). Values are never rounded.
   *
   * Duration configs are tuned against this threshold, so they rest at
   * their `duration` at any precision. See
   * https://github.com/tkofh/coily/blob/main/PRECISION.md.
   *
   * @default 2
   */
  readonly precision?: number | undefined

  /**
   * Velocity multiplier applied each time the value crosses the target.
   *
   * - `'passthrough'` (1) leaves the motion alone. The value swings
   *   through the target and settles as its damping allows.
   * - `'stop'` (0) ends the motion at the first crossing, with no
   *   overshoot however bouncy the config.
   * - A number between -1 and 1 sets the multiplier directly. Negative
   *   values rebound. `-0.75` reverses at three quarters speed on every
   *   return. Values between 0 and 1 pass through slower.
   *
   * A motion that never crosses ignores `arrival`. With `dampingRatio` 1
   * or above (`bounce` 0 or below), a spring retargeted from rest closes
   * in from one side. It crosses only when it starts with enough velocity
   * toward the target, or when the target moves past it.
   *
   * Crossings are solved exactly, never sampled per frame, so `'stop'`
   * lands exactly on the target at any frame timing. See
   * https://github.com/tkofh/coily/blob/main/PRECISION.md.
   *
   * @default 'passthrough'
   */
  readonly arrival?: 'passthrough' | 'stop' | number | undefined
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
  /** Derived from the other parameters in this input shape. Cannot be provided. */
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
   * Friction strength. Higher damping removes velocity faster and
   * reduces bounce. At 0 the spring oscillates forever. Must be greater
   * than or equal to 0.
   */
  readonly damping: number
}

interface WithDampingRatio {
  /**
   * Damping as a fraction of critical damping, the friction at which
   * bounce disappears. It sets the motion's character independent of its
   * speed. Below 1 the spring bounces, and at 0 it never settles. At 1 it
   * settles fastest without overshooting. Above 1 it settles slower, still
   * without overshooting. Must be greater than or equal to 0.
   */
  readonly dampingRatio: number
}

interface WithBounce {
  /**
   * Bounciness, converted to a damping ratio as `1 - bounce`. 0 settles
   * fastest without overshooting. Positive values bounce. Negative values
   * settle slower without bouncing. At 1 the ratio clamps just short of
   * undamped, so the spring still settles. Must be between -1 and 1, and
   * below 1 in a config that sets `damping` without `duration`.
   */
  readonly bounce: number
}

interface WithDuration {
  /**
   * Settle time in ms. Starting `displacement` away from the target, the
   * spring rests within a frame of it at any `precision`. A bouncy config
   * can rest earlier, by up to about one oscillation (several short ones
   * when `bounce` is near 1). Must be greater than 0.
   */
  readonly duration: number
}

interface WithDisplacement {
  /**
   * The starting distance from the target that the `duration` tuning
   * assumes. Set it to your animation's range (300 when animating 0 to
   * 300). Timing drifts as the real distance departs from it. The sign is
   * ignored. The magnitude must exceed the resting threshold,
   * `0.5 * 10^-precision`.
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
  | 'arrival'

/**
 * Marks every option key foreign to `T` as absent or undefined, so mixing
 * keys from different input shapes fails to type-check.
 */
type Exact<T> = T & { [K in Exclude<SpringOptionKeys, keyof T>]?: undefined }

/**
 * Every input `defineSpring` accepts: one of the documented parameter
 * combinations, with no keys mixed in from another.
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
 * Resolved spring parameters, frozen and safe to share between springs.
 * Whatever `defineSpring` input shape produced it, a config has concrete
 * `mass`, `tension`, `damping`, `precision`, and `arrival`, plus the
 * quantities derived from them. To change a spring's behavior, assign a
 * new config to `spring.config`.
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
  /** Decimal places of the resting threshold. See `restingMagnitude`. */
  readonly precision: number
  /**
   * Velocity multiplier applied each time the value crosses the target.
   * `'passthrough'` resolves to 1, which leaves the motion untouched.
   * `'stop'` resolves to 0, which ends it at the target. Negative values
   * rebound.
   */
  readonly arrival: number

  /** Oscillation rate with no damping: `sqrt(tension / mass)`, in radians per second. */
  readonly naturalFrequency: number
  /** The damping at which bounce disappears: `2 * mass * naturalFrequency`. */
  readonly criticalDamping: number
  /**
   * `damping / criticalDamping`. Below 1 the spring bounces. At 1 it
   * settles fastest without overshooting. Above 1 it settles slower.
   */
  readonly dampingRatio: number

  /** Resting threshold in value units, `0.5 * 10^-precision`. */
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
    const arrival = raw.arrival as 'passthrough' | 'stop' | number | undefined

    // The range checks below reject NaN but let infinities through, so
    // every option is checked for finiteness first.
    for (const key of Object.keys(raw)) {
      // The one option that admits strings. Validated on its own below.
      if (key === 'arrival') continue
      const value = raw[key]
      if (value !== undefined) {
        invariant(Number.isFinite(value), () => `Invalid ${key}: expected a finite number`)
      }
    }

    if (mass !== undefined) invariant(mass > 0, 'Mass must be greater than 0')
    if (tension !== undefined) invariant(tension > 0, 'Tension must be greater than 0')
    if (damping !== undefined) invariant(damping >= 0, 'Damping must be greater than or equal to 0')
    if (bounce !== undefined)
      invariant(bounce >= -1 && bounce <= 1, 'Bounce must be between -1 and 1')

    invariant(
      raw.dampingRatio === undefined || bounce === undefined,
      'Provide either dampingRatio or bounce, not both',
    )

    // The floor keeps bounce = 1 settling.
    const dampingRatio =
      raw.dampingRatio ?? (bounce !== undefined ? Math.max(1e-4, 1 - bounce) : undefined)

    if (dampingRatio !== undefined)
      invariant(dampingRatio >= 0, 'Damping ratio must be greater than or equal to 0')
    if (duration !== undefined) invariant(duration > 0, 'Duration must be greater than 0')
    invariant(precision >= 0, 'Precision must be greater than or equal to 0')
    invariant(
      arrival === undefined ||
        arrival === 'passthrough' ||
        arrival === 'stop' ||
        (typeof arrival === 'number' && Number.isFinite(arrival) && arrival >= -1 && arrival <= 1),
      "Arrival must be 'passthrough', 'stop', or a number between -1 and 1",
    )

    this.precision = precision
    this.restingMagnitude = 0.5 / 10 ** precision
    if (arrival === undefined || arrival === 'passthrough') {
      this.arrival = 1
    } else if (arrival === 'stop') {
      this.arrival = 0
    } else {
      // -0 stops like 0. Normalize it so reads see a plain 0.
      this.arrival = arrival === 0 ? 0 : arrival
    }

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
      // bounce 1 clamps to a near-zero ratio, and tension grows with
      // 1 / ratio^2 from there.
      invariant(bounce === undefined || bounce < 1, 'bounce must be < 1 to derive tension')
      this.mass = mass ?? 1
      this.tension = damping ** 2 / (4 * dampingRatio ** 2 * this.mass)
      this.damping = damping
    } else if (hasK && hasC && hasZ && !hasT) {
      invariant(!hasM, 'mass is derived when tension, damping, and dampingRatio are all provided')
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 to derive mass')
      invariant(bounce === undefined || bounce < 1, 'bounce must be < 1 to derive mass')
      this.mass = damping ** 2 / (4 * dampingRatio ** 2 * tension)
      this.tension = tension
      this.damping = damping
    }
    // ── Group 3: Duration-based ─────────────────────────────────────
    else if (hasZ && hasT) {
      const x0 = Math.abs(displacement)

      invariant(
        x0 > this.restingMagnitude,
        () =>
          `Displacement magnitude must be greater than the resting threshold (${this.restingMagnitude} at precision ${precision})`,
      )
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 for duration-based config')

      // The natural frequency at which the decay bound from rest enters the
      // resting threshold exactly at `duration`.
      const wn = restUnits(dampingRatio, x0 / this.restingMagnitude) / duration

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
   * Computes the time in ms until a spring with this config rests from
   * `state`, solved exactly from the motion's decay bound. The spring
   * rests at the first tick at or after it.
   *
   * An underdamped spring can also rest earlier, on a frame that samples
   * a dip in its pulsing rest amplitude, so read the result as "no later
   * than". The motion an early rest cuts off never leaves the resting
   * threshold. See https://github.com/tkofh/coily/blob/main/PRECISION.md.
   *
   * Returns 0 when `state` is already inside the resting threshold.
   * Returns Infinity when the motion never settles: a `dampingRatio` of 0
   * whose `arrival` neither stops nor slows it. With `arrival` 0, the
   * result is capped at the first target crossing, where the spring rests
   * exactly. Other multipliers fold their per-crossing velocity loss into
   * the time.
   */
  computeTimeRemaining(state: SpringState): number {
    const { position, velocity } = state

    if (Math.abs(position) + Math.abs(velocity) / this.naturalFrequency <= this.restingMagnitude) {
      return 0
    }

    // arrival 0 rests exactly at the first crossing. It caps the decay
    // bound, and is the whole answer when the bound never decays.
    const crossing = this.arrival === 0 ? firstCrossing(this, position, velocity) * 1000 : Infinity

    return Math.min(restTime(this, position, velocity) * 1000, crossing)
  }
}

// Bisects for the last time `f` sits above `threshold`. Requires f(0) above
// it and `f` rising at most once, by `peak`, before decaying to 0. Runs at
// duration-config build and on `timeRemaining` reads, never inside a tick.
function solveEntry(f: (t: number) => number, threshold: number, peak: number): number {
  let low = 0
  let high = Math.max(peak, 1e-6)
  while (f(high) > threshold) {
    low = high
    high *= 2
  }
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    if (f(mid) > threshold) {
      low = mid
    } else {
      high = mid
    }
  }
  return high
}

// Seconds until the tightest closed-form bound on the rest amplitude
// |x| + |v| / wn enters the threshold, or Infinity when it never decays.
// Callers test for rest first, so the bound starts above the threshold.
function restTime(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio, restingMagnitude, arrival } = config

  if (dampingRatio < 1) {
    const sigma = dampingRatio * naturalFrequency
    const wd = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2)
    // The rest amplitude is exactly exp(-sigma*t) * R * f(wd*t - phi), with
    // R the oscillation amplitude and f periodic. max(f) = sqrt(2 + 2*zeta)
    // is each pulse's true peak, not a safety margin.
    const R = Math.hypot(position, (velocity + sigma * position) / wd)
    const drop = Math.log((R * Math.sqrt(2 + 2 * dampingRatio)) / restingMagnitude)
    const plain = sigma > 0 ? drop / sigma : Infinity

    const strength = Math.abs(arrival)
    if (strength === 0 || strength === 1) return plain

    // Each crossing (every half period after the first) scales the rest of
    // the trajectory by |arrival|, adding ln(1/|arrival|) * wd/pi to the
    // effective decay rate.
    const first = firstCrossing(config, position, velocity)
    if (plain <= first) return plain
    const loss = (-Math.log(strength) * wd) / Math.PI
    return (drop + loss * first) / (sigma + loss)
  }

  if (dampingRatio === 1) {
    const a0 = Math.abs(position) + Math.abs(velocity) / naturalFrequency
    // |c1 + c2*t| + |c2 - wn*(c1 + c2*t)| / wn <= a0 + 2*|c2|*t, exact from
    // rest and asymptotically tight otherwise. `peak` zeroes its derivative.
    const beta = 2 * Math.abs(velocity + naturalFrequency * position)
    const peak = beta > 0 ? Math.max(0, 1 / naturalFrequency - a0 / beta) : 0
    return solveEntry(
      (t) => Math.exp(-naturalFrequency * t) * (a0 + beta * t),
      restingMagnitude,
      peak,
    )
  }

  const wd = naturalFrequency * Math.sqrt(dampingRatio ** 2 - 1)
  const slow = dampingRatio * naturalFrequency - wd
  const fast = dampingRatio * naturalFrequency + wd
  // Split into the two decaying modes. The bound sums their amplitudes,
  // and it is exact once the fast mode dies out.
  const slowAmplitude =
    (Math.abs(velocity + fast * position) / (2 * wd)) * (1 + slow / naturalFrequency)
  const fastAmplitude =
    (Math.abs(velocity + slow * position) / (2 * wd)) * (1 + fast / naturalFrequency)
  return solveEntry(
    (t) => slowAmplitude * Math.exp(-slow * t) + fastAmplitude * Math.exp(-fast * t),
    restingMagnitude,
    0,
  )
}

// The wn * t at which the from-rest decay bound enters the threshold, for a
// displacement `ratio` thresholds away. Duration shapes set
// wn = restUnits(zeta, x0 / threshold) / T. Mirrors restTime's bounds.
function restUnits(dampingRatio: number, ratio: number): number {
  if (dampingRatio < 1) {
    // From rest, R = x0 / sqrt(1 - zeta^2) and M = sqrt(2 + 2*zeta)
    // reduce to R * M / x0 = sqrt(2 / (1 - zeta)).
    return Math.log(ratio * Math.sqrt(2 / (1 - dampingRatio))) / dampingRatio
  }
  if (dampingRatio === 1) {
    return solveEntry((u) => Math.exp(-u) * (1 + 2 * u), 1 / ratio, 0.5)
  }
  const wd = Math.sqrt(dampingRatio ** 2 - 1)
  const slow = dampingRatio - wd
  const fast = dampingRatio + wd
  const slowAmplitude = (fast / (2 * wd)) * (1 + slow)
  const fastAmplitude = (slow / (2 * wd)) * (1 + fast)
  return solveEntry(
    (u) => slowAmplitude * Math.exp(-slow * u) + fastAmplitude * Math.exp(-fast * u),
    1 / ratio,
    0,
  )
}

// Seconds until the motion's first strictly future target crossing, or
// Infinity. The same per-regime roots the solvers in solver.ts anchor with.
function firstCrossing(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio } = config

  if (dampingRatio < 1) {
    // Zeros of c1*cos(wd*t) + c2*sin(wd*t) fall at wd*t = atan2(-c1, c2)
    // (mod pi), and the first lies in (0, pi].
    const wd = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2)
    const c2 = (velocity + dampingRatio * naturalFrequency * position) / wd
    let theta = Math.atan2(-position, c2) % Math.PI
    if (theta <= 0) theta += Math.PI
    return theta / wd
  }

  if (dampingRatio === 1) {
    // (c1 + c2*t) * exp(-wn*t) has one root, -c1/c2. NaN (a rest state)
    // fails the strictly-future test and becomes Infinity.
    const t = -position / (velocity + naturalFrequency * position)
    return t > 0 ? t : Infinity
  }

  // c1*sinh(wd*t) + c2*cosh(wd*t) crosses zero where tanh(wd*t) = -c2/c1,
  // strictly future only when the velocity term dominates with the
  // opposite sign. Otherwise atanh yields NaN or <= 0, which becomes Infinity.
  const wd = naturalFrequency * Math.sqrt(dampingRatio ** 2 - 1)
  const theta = Math.atanh(
    (-position * wd) / (velocity + dampingRatio * naturalFrequency * position),
  )
  return theta > 0 ? theta / wd : Infinity
}

/** Creates a config with stiffness (`tension`) and friction (`damping`) set directly. */
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
 * derived as `damping^2 / (4 * dampingRatio^2 * mass)`. `dampingRatio`
 * must be greater than 0.
 */
export function defineSpring(input: Exact<DampingRatioOptions>): SpringDefinition
/**
 * Creates a config from friction and bounciness, deriving tension.
 * `bounce` must be less than 1, since the derived tension grows without
 * limit as it nears 1.
 */
export function defineSpring(input: Exact<DampingBounceOptions>): SpringDefinition
/**
 * Creates a config from all three physical parameters. Mass is derived
 * as `damping^2 / (4 * dampingRatio^2 * tension)` and cannot be
 * provided. `dampingRatio` must be greater than 0.
 */
export function defineSpring(input: Exact<TensionDampingRatioOptions>): SpringDefinition
/**
 * Creates a config from tension, damping, and bounce. Mass is derived and
 * cannot be provided. `bounce` must be less than 1, since the derived
 * mass grows without limit as it nears 1.
 */
export function defineSpring(input: Exact<TensionDampingBounceOptions>): SpringDefinition
/**
 * Tunes the spring to rest at `duration` ms, deriving tension and
 * damping. `dampingRatio` sets the motion's character and must be
 * greater than 0.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 *
 * @example
 * ```ts
 * // Tuned for a 300px move. Rests within 750ms.
 * defineSpring({ duration: 750, dampingRatio: 1, displacement: 300 })
 * ```
 */
export function defineSpring(input: Exact<DurationOptions>): SpringDefinition
/**
 * Tunes the spring to rest at `duration` ms, deriving tension and
 * damping. `bounce` sets how oscillatory the settling motion is.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<BounceDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given stiffness to rest at `duration` ms. Mass is
 * derived to meet the timing, then damping from mass and `dampingRatio`.
 * Mass cannot be provided, and `dampingRatio` must be greater than 0.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<TensionDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given stiffness to rest at `duration` ms, with
 * `bounce` setting how oscillatory the settling motion is. Mass is
 * derived to meet the timing and cannot be provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<TensionBounceDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given friction to rest at `duration` ms. Mass is
 * derived to meet the timing, then tension from mass. Mass cannot be
 * provided, and `dampingRatio` must be greater than 0.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<DampingDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given friction to rest at `duration` ms, with
 * `bounce` setting how oscillatory the settling motion is. Mass is
 * derived to meet the timing and cannot be provided.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<DampingBounceDurationOptions>): SpringDefinition
export function defineSpring(input: SpringDefinitionOptions): SpringDefinition {
  return new SpringDefinition(input)
}
