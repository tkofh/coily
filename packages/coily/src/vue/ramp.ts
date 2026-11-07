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
   * What the ramp drives. Under reduced motion, a `'motion'` ramp jumps
   * to a bounded target and holds still on an endless one. A
   * `'nonmotion'` ramp keeps moving. See `Purpose`.
   * @default 'motion'
   */
  purpose?: Purpose | undefined
}

/**
 * The reactive handle `useRamp` returns. It is a writable ref of the
 * ramp's value. It carries `velocity`, `timeRemaining`, and `isResting`
 * refs, plus `settled` and `jumpTo`. Writing the main ref places the
 * ramp at the written value, and the ramp continues toward its target
 * from there.
 *
 * A read of any of the refs puts the ramp in the frame loop. The ramp
 * leaves the loop when nothing reads the refs. A ramp shown in a
 * template updates every frame while the template renders. A ramp read
 * only in an event handler stays in the loop for about two frames after
 * each read. A ramp that nothing reads still moves, and the next read
 * returns its current value.
 *
 * The ref is a `TargetedSource`, so `useSpring` can follow it, and
 * `velocityOf` and `targetOf` accept it. Followers subscribe to the
 * ramp directly, so following never depends on reads of the ref.
 */
export interface RampRef extends Ref<number>, TargetedSource<number> {
  /**
   * The current velocity in value units per second, as a reactive ref.
   * It is `rate` with the sign of the direction to the target while the
   * ramp moves, and 0 at rest. Writes are ignored.
   */
  readonly velocity: Ref<number>
  /**
   * Milliseconds until the ramp reaches its target, as a reactive ref. It
   * is 0 at rest and `Infinity` toward an infinite target. Writes are
   * ignored.
   */
  readonly timeRemaining: Ref<number>
  /** Whether the ramp is at rest, as a reactive ref. Writes are ignored. */
  readonly isResting: Ref<boolean>
  /**
   * A promise that resolves when the ramp next comes to rest. It is
   * already resolved while the ramp rests. While the promise is pending,
   * a bounded ramp stays in the frame loop until it arrives.
   */
  readonly settled: Promise<void>
  /**
   * Places the ramp at `value` and rests it there, target included, until
   * the `target` passed to `useRamp` next changes.
   */
  readonly jumpTo: (value: number) => void
}

/**
 * Creates a ramp and returns it as a `RampRef`. A ramp is a value that
 * moves toward `target` in a straight line at `rate` value units per
 * second, and stops there. A target of `Infinity` or `-Infinity` makes
 * it endless. A spring that follows the ref with the default `arrival`
 * tracks its steady motion exactly, with no frame-to-frame steps. A
 * spring that follows an endless ramp makes a spin that lags behind it
 * like a heavy object.
 *
 * `target` and `rate` are numbers, or refs or getters of a number. A new
 * target sends the ramp there from its current value. A new rate applies
 * from the current value on.
 *
 * Call it during `setup()` below a provided spring system: the
 * coily/nuxt module, or `useSpringSystem()` in an ancestor. The ramp is
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
// infers it. Every update triggers the read refs and marks them unread,
// and any read clears the mark. If an update finds the mark still set,
// no effect re-ran on the last trigger. Nothing tracks the refs, so the
// ramp's subscription lapses. Real frames run after Vue flushes its
// effects, so a tracked ref is always read between two updates.
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
      // A write can start or stop the ramp without an update, for example
      // a rate of 0, or reduced motion that holds an endless ramp. Start
      // and stop still change `isResting`, `velocity`, and `timeRemaining`.
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
  // The source slot gives followers the ramp itself, so their reads and
  // subscriptions skip the refs above.
  Object.defineProperty(ref, SpringSourceSymbol, { value: ramp[SpringSourceSymbol] })

  return ref
}
