import {
  type MaybeRefOrGetter,
  type Ref,
  customRef,
  getCurrentScope,
  onScopeDispose,
  toValue,
  watchSyncEffect,
} from 'vue'
import type { TargetedSource } from '../kinematic-source.ts'
import type { Ramp } from '../ramp.ts'
import type { Purpose } from '../spring.ts'
import { SpringSourceSymbol } from '../spring-source.ts'
import { invariant } from '../util.ts'
import { injectSpringSystem } from './reactive-spring.ts'

/** Options for `useRamp`, read once at creation. */
export interface UseRampOptions {
  /**
   * The value the ramp starts from. Required when the initial target is
   * infinite.
   * @default the initial target, so the ramp starts at rest
   */
  from?: number | undefined
  /**
   * What the ramp drives: a `'motion'` ramp jumps to a bounded target
   * under reduced motion and holds still on an endless one, and a
   * `'nonmotion'` ramp keeps moving. See `Purpose`.
   * @default 'motion'
   */
  purpose?: Purpose | undefined
}

/**
 * The reactive handle `useRamp` returns: a writable ref of the ramp's
 * value, with `velocity`, `timeRemaining`, and `isResting` refs plus
 * `settled` and `jumpTo` attached. Writing the main ref places the ramp
 * at the written value, and it carries on toward its target from there.
 *
 * Reading any of the refs subscribes the ramp to the frame loop, and the
 * subscription lapses once nothing reads them: a ramp shown in a
 * template advances every frame while it renders, and one read only in
 * an event handler advances for about two frames after each read. A
 * ramp nobody reads still moves, and the next read reports where it is.
 *
 * The ref is a `TargetedSource`: `useSpring` follows it, and
 * `velocityOf` and `targetOf` accept it. Followers subscribe to the
 * ramp directly, so following never depends on the ref being read.
 */
export interface RampRef extends Ref<number>, TargetedSource<number> {
  /**
   * The current velocity in value units per second, as a reactive ref:
   * `rate` signed toward the target while moving, 0 at rest. Writes are
   * ignored.
   */
  readonly velocity: Ref<number>
  /**
   * Milliseconds until the ramp reaches its target, as a reactive ref: 0
   * at rest, Infinity toward an infinite target. Writes are ignored.
   */
  readonly timeRemaining: Ref<number>
  /** Whether the ramp is at rest, as a reactive ref. Writes are ignored. */
  readonly isResting: Ref<boolean>
  /**
   * A promise that resolves when the ramp next comes to rest, already
   * resolved while resting. A pending `settled` keeps a bounded ramp
   * advancing with the frame loop until it arrives.
   */
  readonly settled: Promise<void>
  /**
   * Places the ramp at `value` and rests it there, target included, until
   * the `target` passed to `useRamp` next changes.
   */
  readonly jumpTo: (value: number) => void
}

/**
 * Creates a ramp and returns it as a `RampRef`: a value that moves
 * toward `target` at `rate` value units per second, in a straight line,
 * and stops there. `Infinity` or `-Infinity` makes it endless. A spring
 * that follows the ref tracks its steady motion exactly, so an endless
 * ramp makes a spin that lags like an object with inertia.
 *
 * `target` and `rate` are numbers, or refs or getters of one. A new
 * target sends the ramp there from its current value, and a new rate
 * applies from the current value on.
 *
 * Call it during `setup()` below a provided spring system (the
 * coily/nuxt module, or `useSpringSystem()` in an ancestor). The ramp is
 * disposed with the component's scope.
 *
 * @example
 * ```ts
 * const angle = useRamp(Infinity, 270, { from: 0 })
 * const ring = useSpring(angle, { duration: 300, dampingRatio: 1 })
 * // template: <div :style="{ rotate: `${ring}deg` }" />
 *
 * const heading = ref(0)
 * const slew = useRamp(heading, 400) // turns toward heading at 400 deg/s
 * ```
 */
export function useRamp(
  target: MaybeRefOrGetter<number>,
  rate: MaybeRefOrGetter<number>,
  options?: UseRampOptions,
): RampRef {
  const system = injectSpringSystem()
  const initial = toValue(target)
  const from = options?.from ?? initial
  invariant(
    Number.isFinite(from),
    'useRamp needs a finite `from` when its initial target is infinite',
  )
  const ramp = system.createRamp(from, {
    rate: toValue(rate),
    target: initial,
    purpose: options?.purpose,
  })

  watchSyncEffect(() => {
    ramp.target = toValue(target)
  })
  watchSyncEffect(() => {
    ramp.rate = toValue(rate)
  })

  const ref = createRampRef(ramp)
  if (getCurrentScope()) {
    onScopeDispose(() => ramp.dispose())
  }
  return ref
}

// A customRef cannot see when its last reader goes away, so the ref
// infers it. Every update triggers the read refs and marks them unread;
// any read clears the mark. An update that finds the mark still set
// means no effect re-ran on the last trigger, so nothing tracks the refs
// and the ramp's subscription lapses. Real frames run after Vue flushes
// its effects, so a tracked ref is always read between two updates.
function createRampRef(ramp: Ramp): RampRef {
  const triggers = new Set<() => void>()
  let unread = false
  let unsubscribe: (() => void) | null = null

  const triggerAll = () => {
    for (const trigger of triggers) trigger()
  }

  const onUpdate = () => {
    if (unread) {
      unsubscribe!()
      unsubscribe = null
      return
    }
    unread = true
    triggerAll()
  }

  const read = (trigger: () => void) => {
    triggers.add(trigger)
    unread = false
    if (unsubscribe === null) {
      const offUpdate = ramp.onUpdate(onUpdate)
      // Start and stop move `isResting`, `velocity`, and `timeRemaining`
      // without an update when they come from a write, such as a rate of
      // 0 or reduced motion holding an endless ramp.
      const offStart = ramp.onStart(triggerAll)
      const offStop = ramp.onStop(triggerAll)
      unsubscribe = () => {
        offUpdate()
        offStart()
        offStop()
      }
    }
  }

  const value = customRef<number>((track, trigger) => ({
    get() {
      track()
      read(trigger)
      return ramp.value
    },
    set(next) {
      ramp.value = next
      trigger()
    },
  }))

  const readOnly = <T>(get: () => T) =>
    customRef<T>((track, trigger) => ({
      get() {
        track()
        read(trigger)
        return get()
      },
      set() {},
    }))

  const ref = Object.assign(value, {
    velocity: readOnly(() => ramp.velocity),
    timeRemaining: readOnly(() => ramp.timeRemaining),
    isResting: readOnly(() => ramp.isResting),
    jumpTo: (next: number) => ramp.jumpTo(next),
  }) as RampRef

  Object.defineProperty(ref, 'settled', {
    get: () => ramp.settled,
  })
  // The source slot hands followers the ramp itself, so their reads and
  // subscriptions bypass the refs above.
  Object.defineProperty(ref, SpringSourceSymbol, { value: ramp[SpringSourceSymbol] })

  return ref
}
