import type { SpringDefinition, SpringState } from './config.ts'
import { State } from './state.ts'
import { CriticallyDampedSolver, OverdampedSolver, UnderdampedSolver } from './solver.ts'
import { invariant } from './util.ts'

// coily/css — turn a spring config into static CSS.
//
// A spring released from rest has a displacement-independent normalized
// curve, so its SHAPE is a pure function of the config. `springToLinear`
// samples it into a CSS `linear()` easing; the higher-level helpers wrap
// that easing into keyframes, an `animation` or `transition` shorthand, or
// arguments for `element.animate`. Everything here is pure — no DOM, no
// ticker — so it runs at build time or once up front, never per frame.
//
// The settle TIME is not displacement-independent — the absolute rest
// threshold is a different fraction of a small vs large move — so the
// duration is derived at a caller-supplied (or move-sized) displacement.
//
// A pure undamped spring (dampingRatio 0, arrival passthrough) never rests,
// but it is a clean sinusoid. Rather than clamp it, these helpers emit a
// seamless infinite loop: the easing spans one HALF period (monotonic
// 0 -> 1) and `animation-direction: alternate` replays it time-reversed,
// which — since from-rest undamped motion is symmetric per half period —
// reproduces the exact oscillation forever.

export interface LinearEasingOptions {
  /**
   * Animation range the duration is tuned for, in value units. The easing
   * shape is identical regardless; only the settle time scales with it.
   * The keyframe helpers (`springToWaapi`, `springToCss`,
   * `springToTransition`) default it to the largest move among their
   * specs instead.
   * @default 1
   */
  readonly displacement?: number
  /**
   * Max output error of the piecewise-linear approximation, in progress
   * units (0..1). Smaller keeps more stops.
   * @default 0.0025
   */
  readonly maxError?: number
  /**
   * Hard cap on generated duration, in ms, for near-undamped configs.
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
  /** Worst reconstruction error vs the dense trajectory (diagnostic). */
  readonly maxError: number
}

/** The easing of a spring that comes to rest: play it once over `duration`. */
export interface SettlingEasing extends EasingBase {
  readonly mode: 'settle'
}

/**
 * The easing of a spring that never rests — an undamped oscillation,
 * expressed as a seamless loop. Animate the property between its two
 * swing extremes (`from` and `2 * target - from`, target at the 50%
 * midpoint) with `animation-iteration-count: infinite` and
 * `animation-direction: alternate`. `duration` is one half period.
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

// Walk the real solver over `spanSec`, sampling (input-fraction, progress).
// `scale` maps displacement to progress: 1 for a settle (target-relative,
// overshoots past 1), 0.5 for a loop (full-swing-relative, lands on 1 at the
// far extreme). Stops early once the settle bound is reached.
function walk(
  config: SpringDefinition,
  displacement: number,
  spanSec: number,
  scale: number,
  stopAtRest: boolean,
  velocity = 0,
): Point[] {
  const state = new State(config, displacement, velocity)
  const solver = pickSolver(config, state)

  // Resolve oscillation and early curvature: a fraction of the natural
  // period, and enough samples across the span for the loop's short window.
  const period = (2 * Math.PI) / config.naturalFrequency
  const dt = Math.max(1e-4, Math.min(period / 48, spanSec / 160))

  const points: Point[] = [{ x: 0, y: 0 }]
  let t = 0
  // Advance by the clamped step so the final sample lands exactly on the
  // span instead of overshooting into a near-duplicate stop.
  while (spanSec - t > 1e-9) {
    const step = Math.min(dt, spanSec - t)
    solver.tick(step)
    t += step
    points.push({ x: t / spanSec, y: (1 - state.position / displacement) * scale })
    if (stopAtRest && state.isResting) break
  }
  return points
}

function buildEasing(points: ReadonlyArray<Point>, maxError: number) {
  const simplified = simplify(points, maxError)
  return {
    easing: format(simplified),
    stops: simplified.length,
    maxError: reconstructionError(points, simplified),
  }
}

function buildSettle(
  config: SpringDefinition,
  displacement: number,
  durationMs: number,
  maxError: number,
  velocity = 0,
): SettlingEasing {
  const points = walk(config, displacement, durationMs / 1000, 1, true, velocity)

  // Rest is a fixpoint: land the tail exactly on the target. An oscillating
  // spring's amplitude pulses under the threshold up to a pulse before the
  // bound, so pad a flat segment out to the reported duration when it did.
  const last = points[points.length - 1]!
  if (1 - last.x > 1e-6) {
    points.push({ x: 1, y: 1 })
  } else {
    last.x = 1
    last.y = 1
  }

  return { mode: 'settle', duration: durationMs, ...buildEasing(points, maxError) }
}

function buildLoop(
  config: SpringDefinition,
  displacement: number,
  maxError: number,
): LoopingEasing {
  const halfSec = Math.PI / config.naturalFrequency
  const points = walk(config, displacement, halfSec, 0.5, false)

  // The far swing extreme is exactly 1 by construction; snap off cos residue.
  const last = points[points.length - 1]!
  last.x = 1
  last.y = 1

  return {
    mode: 'loop',
    duration: halfSec * 1000,
    direction: 'alternate',
    iterations: 'infinite',
    ...buildEasing(points, maxError),
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

function trim(value: number, places: number): string {
  return Number(value.toFixed(places)).toString()
}

function format(points: ReadonlyArray<Point>): string {
  const stops = points.map((point, i) => {
    const output = trim(point.y, 5)
    // First stop is 0%, last is 100% — the browser infers both.
    if (i === 0 || i === points.length - 1) return output
    return `${output} ${trim(point.x * 100, 2)}%`
  })
  return `linear(${stops.join(', ')})`
}

// Worst output error of the simplified polyline against the dense samples.
function reconstructionError(
  dense: ReadonlyArray<Point>,
  simplified: ReadonlyArray<Point>,
): number {
  let worst = 0
  let j = 0
  for (const point of dense) {
    while (j < simplified.length - 2 && simplified[j + 1]!.x < point.x) j += 1
    const a = simplified[j]!
    const b = simplified[j + 1]!
    const dx = b.x - a.x
    const f = dx === 0 ? 0 : (point.x - a.x) / dx
    worst = Math.max(worst, Math.abs(point.y - (a.y + f * (b.y - a.y))))
  }
  return worst
}

/**
 * Turns a resolved spring config into a CSS `linear()` easing and the
 * duration in ms to pair it with. A spring that settles returns a
 * `'settle'` easing. A pure undamped config (`dampingRatio: 0` with
 * passthrough `arrival`) has no friction and never settles, so it
 * returns a `'loop'` easing for an infinite alternating animation.
 */
export function springToLinear(
  config: SpringDefinition,
  options: LinearEasingOptions = {},
): LinearEasing {
  const displacement = options.displacement ?? 1
  const maxError = options.maxError ?? 0.0025
  const maxDuration = options.maxDuration ?? 10000

  // Pure undamped passthrough never rests but is a clean sinusoid; loop it.
  // Other never-settling combinations (undamped reflection) fall through to
  // the clamp below rather than pretending this loop shape fits them.
  if (config.dampingRatio === 0 && config.arrival === 1) {
    return buildLoop(config, displacement, maxError)
  }

  const settleTime = config.computeTimeRemaining({ position: displacement, velocity: 0 })
  return buildSettle(config, displacement, Math.min(settleTime, maxDuration), maxError)
}

/**
 * Like `springToLinear`, but from a spring caught mid-flight rather than at
 * rest: `state` carries both the displacement from the target (`position`)
 * and the current `velocity`, so the easing continues the motion smoothly
 * instead of restarting. Use it to regenerate an animation when its target
 * changes — the interruption carries momentum instead of stalling. The
 * from-rest shape trick doesn't apply here (the curve now depends on the
 * velocity), so this is computed per interruption, not cached per config.
 *
 * Always a settling easing; `position` must be nonzero.
 */
export function springFromState(
  config: SpringDefinition,
  state: SpringState,
  options: LinearEasingOptions = {},
): LinearEasing {
  const maxError = options.maxError ?? 0.0025
  const maxDuration = options.maxDuration ?? 10000
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
 * Evolves a spring `state` forward by `elapsedMs`, returning the new
 * displacement and velocity. Pair it with a running `element.animate` — read
 * the animation's `currentTime`, evolve the state it started from, and you
 * have the exact live velocity the Web Animations API never exposes, ready
 * to hand to `springFromState` on interruption.
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
  /** The CSS property, e.g. `'opacity'`, `'transform'`, `'translate'`. */
  readonly property: string
  /** Start value. */
  readonly from: number
  /** Target value the spring is tuned toward. */
  readonly to: number
  /**
   * Unit appended to numbers, e.g. `'px'`, `'%'`, `'deg'`.
   * @default ''
   */
  readonly unit?: string
  /**
   * Formats an interpolated number into a property value, overriding
   * `unit` — needed for wrapped values like `(v) => `translateX(${v}px)``.
   */
  readonly format?: (value: number) => string
  /**
   * The property's current velocity, in its units per second. Set it to
   * regenerate an interrupted animation from its live motion so it carries
   * momentum instead of restarting from rest. Single-property only — a
   * from-state easing depends on that property's velocity and can't be
   * shared across properties.
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

// Resolve one shared easing and the merged `from`/`to` keyframes for one or
// more specs. A settle ends at each target; a loop swings symmetrically
// about it, so its far endpoint is the mirror `2 * to - from`, target at the
// 50% midpoint. Specs sharing a property (say, several `transform`
// functions) space-join into one value. Duration tunes to the largest move
// unless the caller overrides `displacement` — one easing spans all
// properties, so they settle in sync rather than each on its own clock.
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
 * from one spring. A settling spring fills forwards; an undamped one repeats
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
 * Builds CSS text for the animation: a `@keyframes` rule and an `animation`
 * shorthand value, driving one property or several from one spring. The
 * `name` option (default `'coily'`) names the `@keyframes` rule and is
 * referenced by the `animation` value.
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

  // `linear()`'s commas are paren-protected, so the shorthand parses as one
  // animation. A settle holds its end value; a loop repeats alternating.
  const animation =
    easing.mode === 'loop'
      ? `${ms} ${easing.easing} infinite alternate ${name}`
      : `${ms} ${easing.easing} forwards ${name}`

  return { keyframes, animation }
}

/**
 * Builds a CSS `transition` value that springs a property change: set it on
 * the element, then change the property (on `:hover`, a toggled class, a
 * state attribute) to animate. Pass several specs for one `transition`
 * across properties.
 *
 * Only settling springs — a transition can't loop. It also can't carry
 * momentum: a change interrupted mid-flight restarts the spring from rest
 * instead of reversing through its current velocity, so it stalls at the
 * turn. For motion that's reversed often, drive a live `Spring` instead. The
 * specs' `from`/`to` only tune the duration; the actual values live in your
 * CSS rules.
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
