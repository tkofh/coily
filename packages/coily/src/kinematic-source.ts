import {
  type SpringSource,
  type SpringSourceApi,
  SpringSourceSymbol,
  isSpringSource,
} from './spring-source.ts'
import { invariant } from './util.ts'

/**
 * A `SpringSourceApi` whose value is in motion, so it also reports the
 * value's derivatives: `velocity` (the rate `value` changes, in value
 * units per second) and `acceleration` (the rate `velocity` changes, in
 * value units per second squared). A `Spring` and a `CompositeSpring`
 * carry both exactly — they fall out of the same equation that drives
 * the motion — as does a source bridging a value whose motion it tracks.
 * A value derived with `mapSpring` does not: it holds no motion of its
 * own, so its derivatives would need the derivative of an arbitrary
 * function. `velocityOf` and `accelerationOf` read this slot.
 */
export interface KinematicSourceApi<T = number> extends SpringSourceApi<T> {
  /** The current velocity, in value units per second. */
  readonly velocity: T
  /** The current acceleration, in value units per second squared. */
  readonly acceleration: T
}

/**
 * A `SpringSource` whose value is in motion, exposing its `velocity` and
 * `acceleration` under the `SpringSourceSymbol` slot — every `Spring`
 * and `CompositeSpring` is one. `velocityOf` and `accelerationOf` accept
 * these; a plain `SpringSource` (such as a `mapSpring` result) is not
 * assignable here, since a value derivation is not in motion.
 */
export interface KinematicSource<T = number> extends SpringSource<T> {
  readonly [SpringSourceSymbol]: KinematicSourceApi<T>
}

export function isKinematicSource(value: unknown): value is KinematicSource<unknown> {
  if (!isSpringSource(value)) return false
  const api = value[SpringSourceSymbol]
  return 'velocity' in api && 'acceleration' in api
}

const NOT_KINEMATIC =
  'expected a source in motion (a Spring or CompositeSpring); a value derived with mapSpring has neither velocity nor acceleration'

/**
 * Derives a source from another's velocity — the rate its value changes,
 * in value units per second. `velocityOf(motion)` is a source that reads
 * `motion`'s current velocity, so speed-driven effects fall out of the
 * same follow and `mapSpring` machinery as everything else: a spring can
 * follow it (`blur.target = velocityOf(motion)`) and a map can shape it
 * (`mapSpring(velocityOf(motion), (v) => 1 + Math.abs(v) * 0.001)` for
 * squash and stretch). A scalar source yields a scalar velocity a spring
 * can follow; a `CompositeSpring` or shape yields a velocity of the same
 * shape, mapped to a scalar the way the composite itself is.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads report the source's
 * current velocity on the fly. It updates when the source does and is
 * released with it — followers detach then, keeping their current
 * target, as they would from a disposed spring.
 *
 * Only a source in motion qualifies — a `Spring`, a `CompositeSpring`,
 * or a source bridging a value whose motion it tracks. A value derived
 * with `mapSpring` has no velocity (its rate of change would need the
 * derivative of the map), so it is rejected at the type level and at
 * runtime; take `velocityOf` of the spring the map reads instead.
 */
export function velocityOf<T>(source: KinematicSource<T>): SpringSource<T> {
  invariant(isKinematicSource(source), NOT_KINEMATIC)
  const api = source[SpringSourceSymbol]
  const velocity: SpringSource<T> = Object.freeze({
    [SpringSourceSymbol]: Object.freeze({
      get value(): T {
        return api.velocity
      },
      onUpdate: (callback: () => void) => api.onUpdate(callback),
      onDispose: (callback: () => void) => api.onDispose(callback),
    }),
  })
  return velocity
}

/**
 * Derives a source from another's acceleration — the rate its velocity
 * changes, in value units per second squared. `accelerationOf(motion)`
 * spikes when `motion` is pushed hardest and passes through zero at the
 * peak of a swing, so force-driven effects fall out of the same follow
 * and `mapSpring` machinery: a spring can follow it, and a map can turn
 * it into an impact flash or a jelly wobble
 * (`mapSpring(accelerationOf(motion), (a) => Math.min(1, Math.abs(a) * 1e-4))`).
 * A scalar source yields a scalar acceleration; a `CompositeSpring` or
 * shape yields an acceleration of the same shape, mapped to a scalar the
 * way the composite itself is.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads report the source's
 * current acceleration on the fly. It updates when the source does and
 * is released with it, followers detaching then as from a disposed
 * spring.
 *
 * Only a source in motion qualifies — a `Spring`, a `CompositeSpring`,
 * or a source bridging a value whose motion it tracks. A value derived
 * with `mapSpring` has no acceleration, so it is rejected at the type
 * level and at runtime; take `accelerationOf` of the spring the map
 * reads instead.
 */
export function accelerationOf<T>(source: KinematicSource<T>): SpringSource<T> {
  invariant(isKinematicSource(source), NOT_KINEMATIC)
  const api = source[SpringSourceSymbol]
  const acceleration: SpringSource<T> = Object.freeze({
    [SpringSourceSymbol]: Object.freeze({
      get value(): T {
        return api.acceleration
      },
      onUpdate: (callback: () => void) => api.onUpdate(callback),
      onDispose: (callback: () => void) => api.onDispose(callback),
    }),
  })
  return acceleration
}
