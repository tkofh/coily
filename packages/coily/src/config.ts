import {
  TAIL,
  criticalCrossing,
  overdampedCrossingAngle,
  underdampedCrossingAngle,
} from './solver.ts'
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
   * than or equal to 0, and greater than 0 in a config that derives
   * tension or mass from it.
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
      invariant(damping > 0, 'damping must be > 0 to derive tension')
      // bounce 1 clamps to a near-zero ratio, and tension grows with
      // 1 / ratio^2 from there.
      invariant(bounce === undefined || bounce < 1, 'bounce must be < 1 to derive tension')
      this.mass = mass ?? 1
      this.tension = damping ** 2 / (4 * dampingRatio ** 2 * this.mass)
      this.damping = damping
    } else if (hasK && hasC && hasZ && !hasT) {
      invariant(!hasM, 'mass is derived when tension, damping, and dampingRatio are all provided')
      invariant(dampingRatio > 0, 'dampingRatio must be > 0 to derive mass')
      invariant(damping > 0, 'damping must be > 0 to derive mass')
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
        invariant(damping > 0, 'damping must be > 0 to derive mass')
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

    // Finite inputs can still derive unusable parameters through overflow
    // or underflow (tension 1e300 over mass 1e-300), and every solver
    // divides by mass, tension, or frequency.
    for (const [name, value, positive] of [
      ['mass', this.mass, true],
      ['tension', this.tension, true],
      ['damping', this.damping, false],
      ['naturalFrequency', this.naturalFrequency, true],
      ['criticalDamping', this.criticalDamping, true],
      ['dampingRatio', this.dampingRatio, false],
      ['restingMagnitude', this.restingMagnitude, true],
    ] as const) {
      invariant(
        Number.isFinite(value) && (positive ? value > 0 : value >= 0),
        () =>
          `Invalid spring config: these inputs resolve to ${name} ${value}, outside the range the solvers support`,
      )
    }

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

// The rest amplitude bound shared by tuning and `restTime`, in every
// regime: |x(t)| + |v(t)| / wn <= exp(-sigma*t) * (a*g(t) + b*h(t)), with
//
//   a = |x0| + |v0| / wn
//   b = |v0 + sigma*x0| + |zeta*v0 + wn*x0|
//
// and g = cosh(wd*t), h = sinh(wd*t) / wd above critical damping, g = 1,
// h = t at it, and g = 1, h = min(t, 1/wd) below it (bounding |cos| and
// |sin(wd*t)| / wd). It follows from the closed forms term by term, is
// exact from rest at and above critical damping, and is continuous through
// dampingRatio 1. A per-mode amplitude sum grows like 1/wd there, which
// made near-critical tuning several times too stiff.
//
// Rises at most once, then decays, as `solveEntry` requires. Below
// critical damping the bound is only tight before the knee 1/wd, so
// `restTime` and `restUnits` also take the oscillation envelope's.
function amplitudeBound(
  a: number,
  b: number,
  dampingRatio: number,
  wn: number,
): (t: number) => number {
  const sigma = dampingRatio * wn
  if (dampingRatio < 1) {
    const knee = 1 / (wn * Math.sqrt((1 - dampingRatio) * (1 + dampingRatio)))
    return (t) => Math.exp(-sigma * t) * (a + b * Math.min(t, knee))
  }
  if (dampingRatio === 1) {
    return (t) => Math.exp(-sigma * t) * (a + b * t)
  }
  const wd = wn * Math.sqrt((dampingRatio - 1) * (dampingRatio + 1))
  // sigma - wd without the cancellation that zeroes it at large ratios,
  // since sigma^2 - wd^2 = wn^2.
  const slow = wn * (wn / (sigma + wd))
  return (t) => {
    const u = wd * t
    // Past TAIL, cosh and sinh are exp(u) / 2 to the last ulp. The slow
    // mode alone also keeps them from overflowing.
    if (u > TAIL) return 0.5 * Math.exp(-slow * t) * (a + b / wd)
    return Math.exp(-sigma * t) * (a * Math.cosh(u) + (b * Math.sinh(u)) / wd)
  }
}

// The time `amplitudeBound` peaks at critical damping, and a starting
// bracket for `solveEntry` elsewhere.
function boundPeak(a: number, b: number, wn: number): number {
  return b > 0 ? Math.max(0, 1 / wn - a / b) : 0
}

// Seconds until the amplitude bound enters the threshold, or Infinity
// when it never decays. Callers test for rest first, so the bound starts
// above the threshold.
function restTime(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio, restingMagnitude, arrival } = config
  const sigma = dampingRatio * naturalFrequency
  const a = Math.abs(position) + Math.abs(velocity) / naturalFrequency
  const b =
    Math.abs(velocity + sigma * position) +
    Math.abs(dampingRatio * velocity + naturalFrequency * position)
  const bound = amplitudeBound(a, b, dampingRatio, naturalFrequency)

  if (dampingRatio >= 1) {
    return solveEntry(bound, restingMagnitude, boundPeak(a, b, naturalFrequency))
  }

  const wd = naturalFrequency * Math.sqrt((1 - dampingRatio) * (1 + dampingRatio))
  // The oscillation envelope: the rest amplitude is exactly
  // exp(-sigma*t) * R * f(wd*t - phi), with R the oscillation amplitude
  // and f periodic. max(f) = sqrt(2 + 2*zeta) is each pulse's true peak,
  // not a safety margin.
  const R = Math.hypot(position, (velocity + sigma * position) / wd)
  const drop = Math.log((R * Math.sqrt(2 + 2 * dampingRatio)) / restingMagnitude)
  let envelope = sigma > 0 ? drop / sigma : Infinity

  const strength = Math.abs(arrival)
  if (strength !== 0 && strength !== 1) {
    // Each crossing (every half period after the first) scales the rest of
    // the trajectory by |arrival|, adding ln(1/|arrival|) * wd/pi to the
    // effective decay rate.
    const first = firstCrossing(config, position, velocity)
    if (envelope > first) {
      const loss = (-Math.log(strength) * wd) / Math.PI
      envelope = (drop + loss * first) / (sigma + loss)
    }
  }

  // A crossing only scales the motion after it by |arrival| <= 1, so the
  // amplitude bound holds through crossings too. It wins near critical
  // damping, where the envelope's R grows like 1/wd. The bound decays once
  // past its peak, so one sample at the envelope's time settles which
  // enters first.
  if (!(envelope < Infinity) || bound(envelope) > restingMagnitude) return envelope
  return Math.min(envelope, solveEntry(bound, restingMagnitude, boundPeak(a, b, naturalFrequency)))
}

// The wn * t at which the from-rest rest amplitude bound enters the
// threshold, for a displacement `ratio` thresholds away: `restTime` in
// units of 1 / wn for x0 = 1, v0 = 0. Duration shapes set
// wn = restUnits(zeta, x0 / threshold) / T.
function restUnits(dampingRatio: number, ratio: number): number {
  const threshold = 1 / ratio
  const b = 1 + dampingRatio
  const bound = amplitudeBound(1, b, dampingRatio, 1)
  if (dampingRatio >= 1) return solveEntry(bound, threshold, boundPeak(1, b, 1))

  // From rest, R = x0 / sqrt(1 - zeta^2) and M = sqrt(2 + 2*zeta)
  // reduce to R * M / x0 = sqrt(2 / (1 - zeta)).
  const envelope = Math.log(ratio * Math.sqrt(2 / (1 - dampingRatio))) / dampingRatio
  if (bound(envelope) > threshold) return envelope
  return Math.min(envelope, solveEntry(bound, threshold, boundPeak(1, b, 1)))
}

// Seconds until the motion's first strictly future target crossing, or
// Infinity. Anchors each regime's constants exactly as its solver does.
function firstCrossing(config: SpringDefinition, position: number, velocity: number): number {
  const { naturalFrequency, dampingRatio } = config
  const sigma = dampingRatio * naturalFrequency

  if (dampingRatio < 1) {
    const wd = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2)
    return underdampedCrossingAngle(position, (velocity + sigma * position) / wd) / wd
  }
  if (dampingRatio === 1) {
    return criticalCrossing(position, velocity + naturalFrequency * position)
  }
  const wd = naturalFrequency * Math.sqrt(dampingRatio ** 2 - 1)
  return overdampedCrossingAngle(velocity + sigma * position, position * wd) / wd
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
 * derived as `damping^2 / (4 * dampingRatio^2 * mass)`. `damping` and
 * `dampingRatio` must be greater than 0.
 */
export function defineSpring(input: Exact<DampingRatioOptions>): SpringDefinition
/**
 * Creates a config from friction and bounciness, deriving tension.
 * `damping` must be greater than 0. `bounce` must be less than 1, since
 * the derived tension grows without limit as it nears 1.
 */
export function defineSpring(input: Exact<DampingBounceOptions>): SpringDefinition
/**
 * Creates a config from all three physical parameters. Mass is derived
 * as `damping^2 / (4 * dampingRatio^2 * tension)` and cannot be
 * provided. `damping` and `dampingRatio` must be greater than 0.
 */
export function defineSpring(input: Exact<TensionDampingRatioOptions>): SpringDefinition
/**
 * Creates a config from tension, damping, and bounce. Mass is derived and
 * cannot be provided. `damping` must be greater than 0. `bounce` must be
 * less than 1, since the derived mass grows without limit as it nears 1.
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
 * provided, and `damping` and `dampingRatio` must be greater than 0.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<DampingDurationOptions>): SpringDefinition
/**
 * Tunes a spring of the given friction to rest at `duration` ms, with
 * `bounce` setting how oscillatory the settling motion is. Mass is
 * derived to meet the timing and cannot be provided. `damping` must be
 * greater than 0.
 *
 * The timing assumes the motion starts `displacement` (default 1) away
 * from the target. Pass your animation's range for accurate timing.
 */
export function defineSpring(input: Exact<DampingBounceDurationOptions>): SpringDefinition
export function defineSpring(input: SpringDefinitionOptions): SpringDefinition {
  return new SpringDefinition(input)
}
