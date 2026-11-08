import type { SpringDefinition, SpringState } from './config.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

// coily/css turns a spring config into static CSS. Everything here is pure
// (no DOM, no ticker), so it runs at build time or once up front.
//
// A from-rest spring's normalized curve is displacement-independent, so its
// SHAPE is a pure function of the config. `springToLinear` samples it into a
// `linear()` easing, and the other helpers wrap that easing. The settle TIME
// does depend on displacement, because the absolute rest threshold is a
// different fraction of a small move than of a large one.
//
// A pure undamped spring (dampingRatio 0, arrival passthrough) never rests
// but is a clean sinusoid, so it becomes an infinite loop. The easing spans
// one HALF period (monotonic 0 -> 1), and `animation-direction: alternate`
// replays it time-reversed. From-rest symmetry makes the replay exact.

export interface LinearEasingOptions {
  /**
   * The size of the move the easing is timed for, in value units. A larger
   * move takes longer to come within the fixed rest threshold, so it gets a
   * longer duration, different `linear()` stop percentages, and possibly a
   * different stop count. The keyframe helpers (`springToWaapi`,
   * `springToCss`, `springToTransition`) default it to the largest move
   * among their specs.
   * @default 1
   */
  readonly displacement?: number
  /**
   * The largest output error allowed in the emitted easing, in progress
   * units (0 at the start, 1 at the target), counting simplification and
   * rounding of the stops. A smaller value keeps more stops at more
   * decimal places. Must be greater than 0.
   * @default 0.0025
   */
  readonly maxError?: number
  /**
   * The longest duration to generate, in ms. It cuts off configs with so
   * little damping (friction) that they take very long to settle. A
   * `'loop'` easing ignores the cap and lasts one half period. Must be
   * finite and greater than 0.
   * @default 10000
   */
  readonly maxDuration?: number
}

interface EasingBase {
  /** A CSS `linear()` easing string. */
  readonly easing: string
  /** Duration to pair the easing with, in ms. */
  readonly duration: number
  /** Number of stops in the easing (diagnostic). */
  readonly stops: number
  /**
   * The largest error of `easing`, as written, against the spring's exact
   * curve, in progress units (diagnostic). It counts rounding of the
   * stops and is measured at twice the density the easing was fit at, so
   * it includes error between the fitted samples. Within the requested
   * `maxError` unless that budget needs more than 400,000 samples.
   */
  readonly maxError: number
}

/** The easing of a spring that comes to rest: play it once over `duration`. */
export interface SettlingEasing extends EasingBase {
  readonly mode: 'settle'
}

/**
 * The easing of a spring that never rests: an undamped oscillation (no
 * friction), expressed as an infinite loop. Animate the property between
 * its two swing extremes, `from` and `2 * target - from`, with the target
 * at the 50% midpoint. Use `animation-iteration-count: infinite` and
 * `animation-direction: alternate`. `duration` is one half period, in ms.
 */
export interface LoopingEasing extends EasingBase {
  readonly mode: 'loop'
  readonly direction: 'alternate'
  readonly iterations: 'infinite'
}

export type LinearEasing = SettlingEasing | LoopingEasing

interface Point {
  x: number // input fraction, 0..1
  y: number // progress (output), 0 -> 1, may exceed 1 on overshoot
  /**
   * The left limit at a step: a stop the fit keeps, but no input reads,
   * since `linear()` returns the later of two stops at one position.
   */
  limit?: boolean
}

function pickSolver(config: SpringDefinition, state: State) {
  const solver =
    config.dampingRatio < 1
      ? new UnderdampedSolver(state)
      : config.dampingRatio === 1
        ? new CriticallyDampedSolver(state)
        : new OverdampedSolver(state)
  solver.configure(config)
  return solver
}

// Walks the real solver over `spanSec` in steps of `dt` seconds, sampling
// (input-fraction, progress). `scale` maps displacement to progress: 1 for
// a settle (target-relative, overshoots past 1), 0.5 for a loop
// (full-swing-relative, lands on 1 at the far extreme).
function walk(
  config: SpringDefinition,
  displacement: number,
  spanSec: number,
  scale: number,
  velocity: number,
  dt: number,
): Point[] {
  const state = new State(config, displacement, velocity)
  const solver = pickSolver(config, state)

  const points: Point[] = [{ x: 0, y: 0 }]
  let t = 0
  // Advance by the clamped step so the final sample lands exactly on the
  // span instead of overshooting into a near-duplicate stop.
  while (spanSec - t > 1e-12 * spanSec) {
    const step = Math.min(dt, spanSec - t)
    solver.tick(step)
    t += step
    points.push({ x: t / spanSec, y: (1 - state.position / displacement) * scale })
  }
  points[points.length - 1]!.x = 1
  return points
}

// The sample count past which tightening stops. The base step alone stays
// under it for the default 10 s cap.
const MAX_SAMPLES = 400_000

// The first sampling step, in seconds: a fraction of the natural period
// for oscillation and early curvature, and at least 160 samples across
// the span, with no absolute floor so short easings keep their shape.
function baseStep(config: SpringDefinition, spanSec: number): number {
  const period = (2 * Math.PI) / config.naturalFrequency
  return Math.max(spanSec / 1e5, Math.min(period / 48, spanSec / 160))
}

/**
 * Fits a `linear()` easing to a curve within `maxError`, counting every
 * source of error in the string it returns: Douglas-Peucker simplification,
 * the curve's bend between samples, and rounding of stop values and
 * percentages. The curve is sampled at twice the fitting density, and the
 * serialized stops are measured against those samples. A fit over budget
 * retries with a halved step, a halved simplification tolerance, and one
 * more decimal place, until it fits or reaches `MAX_SAMPLES`.
 */
function fitEasing(
  sample: (dt: number) => Point[],
  dt: number,
  maxError: number,
): Pick<EasingBase, 'easing' | 'stops' | 'maxError'> {
  // Half the budget simplifies. Serialization and the bend between
  // samples share the rest.
  let epsilon = maxError / 2
  let valuePlaces = Math.max(5, Math.ceil(Math.log10(4 / maxError)))
  for (;;) {
    const fine = sample(dt / 2)
    // The last two samples stay: they are the step onto the target.
    const coarse = fine.filter((_, i) => i % 2 === 0 || i >= fine.length - 2)
    const simplified = simplify(coarse, epsilon)
    const stops = round(simplified, valuePlaces, percentPlaces(simplified, maxError))
    const error = polylineError(fine, stops)
    if (error <= maxError || fine.length * 2 > MAX_SAMPLES) {
      return { easing: format(stops), stops: stops.length, maxError: error }
    }
    dt /= 2
    epsilon /= 2
    valuePlaces++
  }
}

function buildSettle(
  config: SpringDefinition,
  displacement: number,
  durationMs: number,
  maxError: number,
  velocity = 0,
): SettlingEasing {
  const span = durationMs / 1000
  const sample = (dt: number) => {
    const points = walk(config, displacement, span, 1, velocity, dt)
    // The duration bounds the rest, where a live spring snaps onto its
    // target, so the easing steps there: two stops at 100%, which rounds
    // exactly. The curve before it follows the unsnapped motion, which a
    // live spring can cut short up to a pulse early, inside the threshold.
    points[points.length - 1]!.limit = true
    points.push({ x: 1, y: 1 })
    return points
  }
  return {
    mode: 'settle',
    duration: durationMs,
    ...fitEasing(sample, baseStep(config, span), maxError),
  }
}

function buildLoop(
  config: SpringDefinition,
  displacement: number,
  maxError: number,
): LoopingEasing {
  const halfSec = Math.PI / config.naturalFrequency
  const sample = (dt: number) => {
    const points = walk(config, displacement, halfSec, 0.5, 0, dt)
    // The far swing extreme is exactly 1 by construction. Snap off cos residue.
    const last = points[points.length - 1]!
    last.x = 1
    last.y = 1
    return points
  }

  return {
    mode: 'loop',
    duration: halfSec * 1000,
    direction: 'alternate',
    iterations: 'infinite',
    ...fitEasing(sample, baseStep(config, halfSec), maxError),
  }
}

// Vertical-distance Douglas-Peucker. `linear()` interpolates linearly in
// input, so vertical (output) error is exactly the approximation error.
function simplify(points: ReadonlyArray<Point>, epsilon: number): Point[] {
  const keep = Array.from({ length: points.length }, () => false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    const a = points[lo]!
    const b = points[hi]!
    const dx = b.x - a.x

    let worst = -1
    let worstIndex = -1
    for (let i = lo + 1; i < hi; i += 1) {
      const p = points[i]!
      const f = dx === 0 ? 0 : (p.x - a.x) / dx
      const interpolated = a.y + f * (b.y - a.y)
      const distance = Math.abs(p.y - interpolated)
      if (distance > worst) {
        worst = distance
        worstIndex = i
      }
    }

    if (worst > epsilon && worstIndex !== -1) {
      keep[worstIndex] = true
      stack.push([lo, worstIndex], [worstIndex, hi])
    }
  }

  return points.filter((_, i) => keep[i])
}

// Percent decimals that keep rounding a stop's position within an eighth
// of the budget on the steepest segment, and at least 2.
function percentPlaces(points: readonly Point[], maxError: number): number {
  let slope = 0
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    if (dx > 0) slope = Math.max(slope, Math.abs(points[i]!.y - points[i - 1]!.y) / dx)
  }
  // A position rounds by up to 0.5 * 10^-(places + 2) of the input.
  const needed = Math.ceil(Math.log10((4 * slope) / maxError)) - 2
  return Number.isFinite(needed) ? Math.max(2, needed) : 2
}

function trim(value: number, places: number): number {
  return Number(value.toFixed(places))
}

// The stops exactly as `format` writes them. The browser infers the first
// stop at 0% and the last at 100%.
function round(points: readonly Point[], valuePlaces: number, percentPlaces: number): Point[] {
  return points.map((point, i) => ({
    x: i === 0 ? 0 : i === points.length - 1 ? 1 : trim(point.x * 100, percentPlaces) / 100,
    y: trim(point.y, valuePlaces),
  }))
}

function format(stops: readonly Point[]): string {
  const parts = stops.map((stop, i) => {
    const output = String(stop.y)
    if (i === 0 || i === stops.length - 1) return output
    // toPrecision drops the binary residue of dividing by 100 in `round`.
    return `${output} ${Number((stop.x * 100).toPrecision(12))}%`
  })
  return `linear(${parts.join(', ')})`
}

// Worst output error of the stops' polyline against the samples. Stops
// can share a position, where `linear()` steps to the later one.
function polylineError(samples: readonly Point[], stops: readonly Point[]): number {
  let worst = 0
  let j = 0
  for (const point of samples) {
    if (point.limit) continue
    while (j < stops.length - 2 && stops[j + 1]!.x <= point.x) j += 1
    const a = stops[j]!
    const b = stops[j + 1]!
    const dx = b.x - a.x
    const f = dx === 0 ? 1 : Math.min(1, Math.max(0, (point.x - a.x) / dx))
    worst = Math.max(worst, Math.abs(point.y - (a.y + f * (b.y - a.y))))
  }
  return worst
}

function resolveLimits(options: LinearEasingOptions) {
  const maxError = options.maxError ?? 0.0025
  const maxDuration = options.maxDuration ?? 10000
  invariant(Number.isFinite(maxError) && maxError > 0, 'maxError must be a finite number > 0')
  invariant(
    Number.isFinite(maxDuration) && maxDuration > 0,
    'maxDuration must be a finite number of ms > 0',
  )
  return { maxError, maxDuration }
}

/**
 * Turns a spring config into a CSS `linear()` easing and the duration in
 * ms to pair it with. A settling config returns a `'settle'` easing. A
 * pure undamped config (`dampingRatio: 0` with passthrough `arrival`)
 * never settles and returns a `'loop'` easing for an infinite alternating
 * animation. Any other config that never settles, such as
 * `dampingRatio: 0` with `arrival: -1`, returns a `'settle'` easing cut
 * off at `maxDuration`.
 */
export function springToLinear(
  config: SpringDefinition,
  options: LinearEasingOptions = {},
): LinearEasing {
  const displacement = options.displacement ?? 1
  invariant(
    Number.isFinite(displacement) && displacement !== 0,
    'displacement must be a finite, nonzero number',
  )
  const { maxError, maxDuration } = resolveLimits(options)

  // Undamped reflection never rests either, but the loop shape doesn't fit
  // it, so it falls through to the clamp.
  if (config.dampingRatio === 0 && config.arrival === 1) {
    return buildLoop(config, displacement, maxError)
  }

  const settleTime = config.computeTimeRemaining({ position: displacement, velocity: 0 })
  return buildSettle(config, displacement, Math.min(settleTime, maxDuration), maxError)
}

/**
 * Like `springToLinear`, but for a spring caught mid-flight. `state`
 * carries the displacement from the target (`position`) and the current
 * `velocity`, so the easing continues the motion instead of restarting it.
 * Use it to regenerate an animation when its target changes. The curve
 * depends on the velocity, so compute it per interruption instead of
 * caching it per config.
 *
 * The result is always a `'settle'` easing, timed from `position`, so
 * `options.displacement` is ignored. A config that never settles is cut
 * off at `maxDuration`. Throws when `position` is 0 (within 1e-9), even if
 * `velocity` is not.
 */
export function springFromState(
  config: SpringDefinition,
  state: SpringState,
  options: LinearEasingOptions = {},
): LinearEasing {
  const { maxError, maxDuration } = resolveLimits(options)
  invariant(
    Number.isFinite(state.position) && Number.isFinite(state.velocity),
    'springFromState needs a finite position and velocity',
  )
  invariant(
    Math.abs(state.position) > 1e-9,
    'springFromState needs a nonzero position (the value and target must differ)',
  )
  const settleTime = config.computeTimeRemaining(state)
  return buildSettle(
    config,
    state.position,
    Math.min(settleTime, maxDuration),
    maxError,
    state.velocity,
  )
}

/**
 * Advances a spring `state` by `elapsedMs` ms and returns the new
 * displacement and velocity. `elapsedMs <= 0` returns a copy of `state`.
 *
 * The Web Animations API doesn't expose velocity, so to interrupt a running
 * `element.animate`, advance the state it started from by its `currentTime`
 * and hand the result to `springFromState`.
 */
export function springStateAt(
  config: SpringDefinition,
  state: SpringState,
  elapsedMs: number,
): SpringState {
  if (elapsedMs <= 0) return { position: state.position, velocity: state.velocity }
  const live = new State(config, state.position, state.velocity)
  pickSolver(config, live).tick(elapsedMs / 1000)
  return { position: live.position, velocity: live.velocity }
}

/** What to animate: a CSS property from one numeric value to another. */
export interface PropertySpec {
  /** The CSS property, for example `'opacity'`, `'transform'`, or `'translate'`. */
  readonly property: string
  /** The start value. */
  readonly from: number
  /** The target value. */
  readonly to: number
  /**
   * Unit appended to numbers, for example `'px'`, `'%'`, or `'deg'`.
   * @default ''
   */
  readonly unit?: string
  /**
   * Formats an interpolated number into a property value, overriding
   * `unit`. Use it for values that wrap the number, such as
   * ``(v) => `translateX(${v}px)` ``.
   */
  readonly format?: (value: number) => string
  /**
   * The property's current velocity, in its units per second. Set it to
   * regenerate an interrupted animation with its momentum instead of from
   * rest. A spec with a nonzero velocity must be the only spec in the call,
   * or the call throws.
   */
  readonly velocity?: number
}

export interface CssOptions extends LinearEasingOptions {
  /**
   * Name for the generated `@keyframes` rule.
   * @default 'coily'
   */
  readonly name?: string
}

// Resolves the merged `from`/`to` keyframes and one shared easing, so all
// properties settle together. A loop's far endpoint is the mirror
// `2 * to - from`. Specs sharing a property (say, several `transform`
// functions) space-join into one value. Duration tunes to the largest move
// unless the caller overrides `displacement`.
function resolveSpecs(
  config: SpringDefinition,
  specs: PropertySpec[],
  options: LinearEasingOptions,
) {
  const withVelocity = specs.some((spec) => (spec.velocity ?? 0) !== 0)
  invariant(
    !withVelocity || specs.length === 1,
    'velocity handoff is single-property: a from-state easing depends on that property, so run one animation per property',
  )

  const first = specs[0]!
  const easing = withVelocity
    ? springFromState(
        config,
        { position: first.from - first.to, velocity: first.velocity! },
        options,
      )
    : springToLinear(config, {
        ...options,
        displacement:
          options.displacement ?? (Math.max(...specs.map((s) => Math.abs(s.to - s.from))) || 1),
      })

  const from: Record<string, string> = {}
  const to: Record<string, string> = {}
  for (const spec of specs) {
    const format =
      spec.format ?? ((value: number) => `${Number(value.toFixed(3))}${spec.unit ?? ''}`)
    const far = easing.mode === 'loop' ? 2 * spec.to - spec.from : spec.to
    const start = format(spec.from)
    const end = format(far)
    from[spec.property] = from[spec.property] ? `${from[spec.property]} ${start}` : start
    to[spec.property] = to[spec.property] ? `${to[spec.property]} ${end}` : end
  }
  return { easing, from, to }
}

function asArray(spec: PropertySpec | PropertySpec[]): PropertySpec[] {
  return Array.isArray(spec) ? spec : [spec]
}

/**
 * Builds arguments for `element.animate(keyframes, options)`: two keyframes
 * carrying the endpoint values, and options carrying the spring's `linear()`
 * easing and duration. Pass an array of specs to drive several properties
 * from one spring. A settling spring fills forwards. An undamped one repeats
 * infinitely in alternating directions.
 *
 * @example
 * ```ts
 * const { keyframes, options } = springToWaapi(config, {
 *   property: 'translate',
 *   from: 0,
 *   to: 300,
 *   unit: 'px',
 * })
 * element.animate(keyframes, options)
 * ```
 */
export function springToWaapi(
  config: SpringDefinition,
  spec: PropertySpec | PropertySpec[],
  options: LinearEasingOptions = {},
): { keyframes: Keyframe[]; options: KeyframeAnimationOptions } {
  const { easing, from, to } = resolveSpecs(config, asArray(spec), options)
  const keyframes: Keyframe[] = [from, to]

  const shared = { duration: easing.duration, easing: easing.easing }
  return {
    keyframes,
    options:
      easing.mode === 'loop'
        ? { ...shared, iterations: Number.POSITIVE_INFINITY, direction: 'alternate' }
        : { ...shared, fill: 'forwards' },
  }
}

/**
 * Builds CSS text for the animation: a `@keyframes` rule named by `name`
 * (default `'coily'`) and an `animation` shorthand value that references
 * it, driving one property or several from one spring. A settling spring
 * fills forwards. An undamped one repeats infinitely in alternating
 * directions.
 *
 * @example
 * ```ts
 * const { keyframes, animation } = springToCss(config, {
 *   property: 'translate',
 *   from: 0,
 *   to: 300,
 *   unit: 'px',
 * })
 * const style = document.createElement('style')
 * style.textContent = keyframes
 * document.head.append(style)
 * element.style.animation = animation
 * ```
 */
export function springToCss(
  config: SpringDefinition,
  spec: PropertySpec | PropertySpec[],
  options: CssOptions = {},
): { keyframes: string; animation: string } {
  const { easing, from, to } = resolveSpecs(config, asArray(spec), options)
  const name = options.name ?? 'coily'
  const ms = `${Number(easing.duration.toFixed(1))}ms`

  const declare = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([property, value]) => `${property}: ${value};`)
      .join(' ')

  const keyframes =
    `@keyframes ${name} {\n` + `  from { ${declare(from)} }\n` + `  to { ${declare(to)} }\n` + `}`

  // `linear()`'s commas are paren-protected, so this parses as one animation.
  const animation =
    easing.mode === 'loop'
      ? `${ms} ${easing.easing} infinite alternate ${name}`
      : `${ms} ${easing.easing} forwards ${name}`

  return { keyframes, animation }
}

/**
 * Builds a CSS `transition` value that animates a property change with the
 * spring. Set it on the element, then change the property, for example on
 * `:hover`, with a toggled class, or with a state attribute. Pass several
 * specs to build one `transition` for several properties.
 *
 * The values come from your CSS rules. Each spec's `from` and `to` only
 * size the move, which tunes the duration. An undamped (looping) config
 * throws, because a transition cannot loop.
 *
 * A transition starts from rest unless its spec carries a `velocity`, in
 * the property's units per second, such as a drag's speed at release. The
 * velocity reshapes the curve and the duration, so build the transition at
 * the handoff. A spec with a velocity must be the only spec in the call.
 *
 * ```ts
 * // Release a dragged card back to 0 at the drag's speed.
 * card.style.transition = springToTransition(config, {
 *   property: 'translate',
 *   from: dragX,
 *   to: 0,
 *   velocity: releaseVelocity,
 * })
 * card.style.translate = '0px'
 * ```
 *
 * The browser carries no momentum between transitions, so a change that
 * interrupts one mid-flight stalls at the turn. To keep the momentum, read
 * the velocity with `springStateAt` and rebuild the transition with it.
 * For motion that reverses often, drive a live `Spring` instead.
 */
export function springToTransition(
  config: SpringDefinition,
  spec: PropertySpec | PropertySpec[],
  options: LinearEasingOptions = {},
): string {
  const specs = asArray(spec)
  const { easing } = resolveSpecs(config, specs, options)
  invariant(
    easing.mode === 'settle',
    'springToTransition requires a settling spring; an undamped (looping) config has no single end state to transition to',
  )
  const ms = `${Number(easing.duration.toFixed(1))}ms`
  return specs.map((s) => `${s.property} ${ms} ${easing.easing}`).join(', ')
}
