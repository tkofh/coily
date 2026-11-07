import {
  type SpringSource,
  type SpringSourceApi,
  SpringSourceSymbol,
  isSpringSource,
  registerRecipe,
} from './spring-source.ts'
import { invariant } from './util.ts'

/**
 * A `SpringSourceApi` whose value is in motion, so it also reports the
 * value's derivatives: `velocity` (the rate `value` changes, in value
 * units per second) and `acceleration` (the rate `velocity` changes, in
 * value units per second squared). A `Spring`, a `CompositeSpring`, and
 * a `Ramp` report both exactly, from the same model that moves the
 * value. A source you write yourself can report them too, if it tracks
 * a value in motion. A value derived with `mapSpring` cannot. It holds
 * no motion of its own, so its derivatives would need the derivative of
 * an arbitrary function. `velocityOf` and `accelerationOf` read this
 * slot.
 */
export interface KinematicSourceApi<T = number> extends SpringSourceApi<T> {
  /** The current velocity, in value units per second. */
  readonly velocity: T
  /** The current acceleration, in value units per second squared. */
  readonly acceleration: T
}

/**
 * A `SpringSource` whose value is in motion, so it also carries the
 * value's `velocity` and `acceleration`. Every `Spring`,
 * `CompositeSpring`, and `Ramp` is one. `velocityOf` and
 * `accelerationOf` accept these. A plain `SpringSource`, such as a
 * `mapSpring` result, is not assignable, because a value derivation is
 * not in motion.
 */
export interface KinematicSource<T = number> extends SpringSource<T> {
  readonly [SpringSourceSymbol]: KinematicSourceApi<T>
}

/**
 * A `KinematicSourceApi` that also reports `target`, the value its motion
 * is heading toward, in value units. A `Spring`, a `CompositeSpring`,
 * and a `Ramp` carry it, and `targetOf` reads it.
 */
export interface TargetedSourceApi<T = number> extends KinematicSourceApi<T> {
  /** The value the motion is heading toward, in value units. */
  readonly target: T
}

/**
 * A `KinematicSource` that also carries the `target` its motion is heading
 * toward: every `Spring`, `CompositeSpring`, and `Ramp`, and the Vue refs
 * that wrap them. `targetOf` accepts these. A `mapSpring` result is not
 * assignable, because a value derivation has no target.
 */
export interface TargetedSource<T = number> extends KinematicSource<T> {
  readonly [SpringSourceSymbol]: TargetedSourceApi<T>
}

export function isKinematicSource(value: unknown): value is KinematicSource<unknown> {
  if (!isSpringSource(value)) return false
  const api = value[SpringSourceSymbol]
  return 'velocity' in api && 'acceleration' in api
}

// A stateless view over one slot of `source`. It updates and releases
// with `source`. The recipe makes the wrapper transparent: `mapSpring`
// flattens through it, and leader resolution reaches `source` directly.
function deriveView<T>(source: SpringSource<unknown>, read: () => T): SpringSource<T> {
  const api = source[SpringSourceSymbol]
  const view: SpringSource<T> = Object.freeze({
    [SpringSourceSymbol]: Object.freeze({
      get value(): T {
        return read()
      },
      onUpdate: (callback: () => void) => api.onUpdate(callback),
      onDispose: (callback: () => void) => api.onDispose(callback),
    }),
  })
  registerRecipe(view, { sources: [source], read, fns: [] })
  return view
}

const NOT_KINEMATIC =
  'expected a source in motion (a Spring or CompositeSpring); a value derived with mapSpring has neither velocity nor acceleration'

/**
 * Derives a source from another's velocity: the rate its value changes,
 * in value units per second. `velocityOf(motion)` is a source that reads
 * `motion`'s current velocity. Speed-driven effects then use the same
 * follow and `mapSpring` tools as everything else. A spring can follow
 * it (`blur.target = velocityOf(motion)`), and a map can shape it
 * (`mapSpring(velocityOf(motion), (v) => 1 + Math.abs(v) * 0.001)` for
 * squash and stretch). A scalar source yields a scalar velocity that a
 * spring can follow. A `CompositeSpring` yields a velocity of the same
 * shape, which you map to a scalar the same way as the composite's
 * value.
 *
 * The result is a stateless view, not a spring. It holds no
 * subscriptions and needs no disposal, and each read reports the
 * source's current velocity. It updates when the source does and is
 * released with it. Followers detach then and keep their current
 * target, as they would from a disposed spring.
 *
 * Only a source in motion qualifies: a `Spring`, a `CompositeSpring`, a
 * `Ramp`, or a Vue ref that wraps one. A value derived with `mapSpring`
 * has no velocity, because its rate of change would need the derivative
 * of the map. `velocityOf` rejects it at the type level and at runtime.
 * Take `velocityOf` of the spring the map reads instead.
 */
export function velocityOf<T>(source: KinematicSource<T>): SpringSource<T> {
  invariant(isKinematicSource(source), NOT_KINEMATIC)
  const api = source[SpringSourceSymbol]
  return deriveView(source, () => api.velocity)
}

/**
 * Derives a source from another's acceleration: the rate its velocity
 * changes, in value units per second squared. `accelerationOf(motion)`
 * is largest just after a retarget and near the far end of each swing,
 * and it passes through zero where a swing moves fastest. Force-driven
 * effects then use the same follow and `mapSpring` tools. A spring can follow it, and a map
 * can turn it into an impact flash or a jelly wobble
 * (`mapSpring(accelerationOf(motion), (a) => Math.min(1, Math.abs(a) * 1e-4))`).
 * A scalar source yields a scalar acceleration. A `CompositeSpring`
 * yields an acceleration of the same shape, which you map to a scalar
 * the same way as the composite's value. A `Ramp`'s acceleration is
 * always 0.
 *
 * The result is a stateless view, not a spring. It holds no
 * subscriptions and needs no disposal, and each read reports the
 * source's current acceleration. It updates when the source does and is
 * released with it. Followers detach then and keep their current
 * target, as they would from a disposed spring.
 *
 * Only a source in motion qualifies: a `Spring`, a `CompositeSpring`, a
 * `Ramp`, or a Vue ref that wraps one. A value derived with `mapSpring`
 * has no acceleration. `accelerationOf` rejects it at the type level and
 * at runtime. Take `accelerationOf` of the spring the map reads instead.
 */
export function accelerationOf<T>(source: KinematicSource<T>): SpringSource<T> {
  invariant(isKinematicSource(source), NOT_KINEMATIC)
  const api = source[SpringSourceSymbol]
  return deriveView(source, () => api.acceleration)
}

function isTargetedSource(value: unknown): value is TargetedSource<unknown> {
  return isKinematicSource(value) && 'target' in value[SpringSourceSymbol]
}

const NO_TARGET =
  'expected a spring (a Spring or CompositeSpring); a value derived with mapSpring has no target'

/**
 * Derives a source from a spring's or ramp's target: where it is
 * heading, not where it is. Pair it with the source itself in a
 * `mapSpring` shape to measure anything against the destination, such
 * as remaining travel, progress, or a lead that anticipates the move. A
 * `Spring` or a bounded `Ramp` yields a scalar target that a spring can
 * follow. An endless `Ramp` yields `Infinity` or `-Infinity`, and a
 * spring that follows that target throws. A `CompositeSpring` yields a
 * target of the same shape, which you map to a scalar the same way as
 * the composite's value.
 *
 * ```ts
 * const system = createSpringSystem()
 * const body = system.createSpring(0)
 * // The eyes look ahead by the body's remaining travel, capped at 20.
 * const lead = mapSpring({ value: body, target: targetOf(body) }, ({ value, target }) =>
 *   Math.max(-20, Math.min(20, target - value)),
 * )
 * const eyes = system.createSpring(lead)
 *
 * body.target = 100
 * system.advance(100)
 * eyes.target // 20: the body still has more than 20 to go
 * ```
 *
 * The result is a stateless view, not a spring. It holds no
 * subscriptions and needs no disposal, and each read reports the
 * spring's current target. It updates when the spring does. Assigning
 * `target` emits nothing by itself, so followers pick up a new target
 * on the next frame, the one where the spring starts toward it. Under
 * reduced motion, a `'motion'` spring jumps to its new target and
 * notifies followers at once. The view is released with the spring.
 * Followers detach then and keep their current target.
 *
 * Only a spring or a ramp has a target: a `Spring`, a `CompositeSpring`,
 * a `Ramp`, or a Vue ref that wraps one. `targetOf` rejects a value
 * derived with `mapSpring` at the type level and at runtime.
 */
export function targetOf<T>(spring: TargetedSource<T>): SpringSource<T> {
  invariant(isTargetedSource(spring), NO_TARGET)
  const api = spring[SpringSourceSymbol]
  return deriveView(spring, () => api.target)
}
