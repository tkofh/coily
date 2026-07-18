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

  /**
   * What the motion does when the value reaches the target, as a
   * multiplier applied to the velocity at every crossing.
   *
   * - `'passthrough'` — multiplier 1. The motion is untouched: the value
   *   swings through the target and settles as its damping dictates.
   * - `'stop'` — multiplier 0. Motion ends at the target the first time
   *   the value gets there, with no overshoot, however bouncy the config.
   * - A number between -1 and 1 sets the multiplier directly. Negative
   *   values rebound: `-0.75` reverses the motion with three quarters of
   *   its speed, at every return. Values between 0 and 1 pass through
   *   slowed.
   *
   * Crossings are solved from the motion's closed form, never sampled
   * frame by frame, so a `'stop'` lands the value exactly on the target
   * whatever the frame timing. See
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
   * Settle time in milliseconds. The spring is tuned so it rests at this
   * time, assuming it starts `displacement` away from the target: rest
   * lands within a frame of the requested duration, and a bouncy config
   * can rest up to one oscillation earlier. Must be greater than 0.
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
  | 'arrival'

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
  /**
   * Velocity multiplier applied when the value crosses the target, as
   * provided or resolved from its named form. 1 (`'passthrough'`) leaves
   * the motion untouched, 0 (`'stop'`) ends it at the target, negative
   * values rebound.
   */
  readonly arrival: number

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
    const arrival = raw.arrival as 'passthrough' | 'stop' | number | undefined

    // Every provided option must be a finite number before its own range
    // check: comparisons reject NaN on their own, but let infinities
    // through to poison the derived parameters.
    for (const key of Object.keys(raw)) {
      // The one option that admits strings; validated on its own below.
      if (key === 'arrival') continue
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
      // -0 stops like 0; normalize so reads see a plain 0.
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
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 for duration-based config')

      // The natural frequency that makes the from-rest decay bound enter
      // the threshold exactly at `duration`: rest lands on the requested
      // schedule instead of comfortably inside it.
      const wn = restUnits(dampingRatio, x0 / threshold) / duration

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
   * Computes when a spring with this config comes to rest from `state`,
   * in ms.
   *
   * The time is solved from the motion's decay bound rather than
   * estimated: the spring is resting at the first tick at or after it.
   * An underdamped spring can also rest earlier — its rest amplitude
   * pulses, and a frame that samples a dip inside the resting threshold
   * rests there — so read the value as "no later than", tight in
   * practice. See
   * https://github.com/tkofh/coily/blob/main/PRECISION.md.
   *
   * Returns 0 when `state` is already inside the resting threshold.
   * Returns Infinity when the motion never settles: a `dampingRatio` of
   * 0 whose `arrival` neither stops nor slows it. When `arrival` is 0
   * the result is capped at the first target crossing, where such a
   * spring rests exactly; other multipliers fold their per-crossing
   * velocity loss into the time.
   */
  computeTimeRemaining(state: SpringState): number {
    const { position, velocity } = state

    if (Math.abs(position) + Math.abs(velocity) / this.naturalFrequency <= this.restingMagnitude) {
      return 0
    }

    // An arrival multiplier of 0 turns the first target crossing into
    // exact rest: it caps the decay bound, and answers alone when the
    // bound never decays.
    const crossing = this.arrival === 0 ? firstCrossing(this, position, velocity) * 1000 : Infinity

    return Math.min(restTime(this, position, velocity) * 1000, crossing)
  }
}

// Last time a decay bound sits above `threshold`, by bisection: `f` must
// rise at most once and then decay to 0, with f(0) above the threshold;
// `peak` is a time at or past the rise. Runs on configuration, never per
// tick.
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

// When the motion from (position, velocity) is guaranteed at rest, in
// seconds: the exact entry of the tightest closed-form bound on the rest
// amplitude |x| + |v| / wn into the resting threshold. Infinity when the
// bound never decays. Callers gate on the resting predicate first, so
// the bound starts above the threshold.
function restTime(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio, restingMagnitude, arrival } = config

  if (dampingRatio < 1) {
    const sigma = dampingRatio * naturalFrequency
    const wd = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2)
    // The rest amplitude is exactly exp(-sigma*t) * R * f(wd*t - phi)
    // with R the oscillation amplitude and f periodic,
    // max(f) = sqrt(2 + 2*zeta) — a strict pulse maximum, not a margin.
    const R = Math.hypot(position, (velocity + sigma * position) / wd)
    const drop = Math.log((R * Math.sqrt(2 + 2 * dampingRatio)) / restingMagnitude)
    const plain = sigma > 0 ? drop / sigma : Infinity

    const strength = Math.abs(arrival)
    if (strength === 0 || strength === 1) return plain

    // A rebound or slowdown scales the whole remaining trajectory by
    // |arrival| at every crossing — every half period past the first —
    // adding ln(1/|arrival|) * wd/pi to the effective decay rate.
    const first = firstCrossing(config, position, velocity)
    if (plain <= first) return plain
    const loss = (-Math.log(strength) * wd) / Math.PI
    return (drop + loss * first) / (sigma + loss)
  }

  if (dampingRatio === 1) {
    const a0 = Math.abs(position) + Math.abs(velocity) / naturalFrequency
    // |c1 + c2*t| + |c2 - wn*(c1 + c2*t)| / wn <= a0 + 2*|c2|*t: exact
    // from rest, asymptotically tight otherwise. Peak of the bound sits
    // where its derivative crosses zero.
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
  // Decomposed onto the two decaying modes; the bound sums their
  // amplitudes, exact once the fast mode dies.
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

// Dimensionless wn * t at which a from-rest motion's decay bound enters
// the threshold, for a displacement `ratio` times the threshold. The
// duration shapes invert this — wn = restUnits(zeta, x0 / threshold) / T
// lands rest exactly at T. Mirrors restTime's per-regime bounds.
function restUnits(dampingRatio: number, ratio: number): number {
  if (dampingRatio < 1) {
    // From rest, R = x0 / sqrt(1 - zeta^2) and M = sqrt(2 + 2*zeta)
    // collapse to R * M / x0 = sqrt(2 / (1 - zeta)).
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

// First strictly future time (seconds) at which the motion from
// (position, velocity) crosses the target, Infinity when it never does.
// The same per-regime roots the solvers anchor with; see solver.ts.
function firstCrossing(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio } = config

  if (dampingRatio < 1) {
    // Zeros of c1*cos(wd*t) + c2*sin(wd*t) fall at wd*t = atan2(-c1, c2)
    // (mod pi); the first lies in (0, pi].
    const wd = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2)
    const c2 = (velocity + dampingRatio * naturalFrequency * position) / wd
    let theta = Math.atan2(-position, c2) % Math.PI
    if (theta <= 0) theta += Math.PI
    return theta / wd
  }

  if (dampingRatio === 1) {
    // (c1 + c2*t) * exp(-wn*t) has one root, -c1/c2; a crossing only when
    // strictly future. NaN (a rest state) compares false into Infinity.
    const t = -position / (velocity + naturalFrequency * position)
    return t > 0 ? t : Infinity
  }

  // c1*sinh(wd*t) + c2*cosh(wd*t) crosses zero where tanh(wd*t) = -c2/c1:
  // a strictly future root only when the velocity term dominates with
  // opposing sign. atanh yields NaN or a non-positive value otherwise,
  // comparing false into Infinity.
  const wd = naturalFrequency * Math.sqrt(dampingRatio ** 2 - 1)
  const theta = Math.atanh(
    (-position * wd) / (velocity + dampingRatio * naturalFrequency * position),
  )
  return theta > 0 ? theta / wd : Infinity
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
 * Tunes the spring to rest at `duration` milliseconds, with
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
 * Tunes the spring to rest at `duration` milliseconds, with
 * `bounce` setting how oscillatory the settling motion is. Tension and
 * damping are both derived.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target — pass a `displacement` matching your animation range
 * for accurate timing.
 */
export function defineSpring(input: Exact<BounceDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given stiffness to rest at `duration`
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
 * Tunes a spring of the given stiffness to rest at `duration`
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
 * Tunes a spring of the given friction to rest at `duration`
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
 * Tunes a spring of the given friction to rest at `duration`
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
