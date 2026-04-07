import {
  type MaybeRefOrGetter,
  type Ref,
  computed,
  customRef,
  getCurrentScope,
  inject,
  onScopeDispose,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringConfig } from '../config.ts'
import { Spring2D } from '../spring2d.ts'
import type { Vector2 } from '../vector2.ts'
import { SpringSystemKey } from './system.ts'
import type { UseSpringOptions } from './spring.ts'

// ── SpringRef2D ─────────────────────────────────────────────────────

export interface SpringRef2D extends Ref<Readonly<Vector2>> {
  readonly velocity: Ref<Readonly<Vector2>>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  readonly jumpTo: (value: Vector2) => void
}

/** @internal Symbol to access the underlying Spring2D from a SpringRef2D */
const Spring2DInstanceKey = Symbol('spring2d')

type Spring2DRefWithInstance = SpringRef2D & { [Spring2DInstanceKey]: Spring2D }

function hasSpring2DInstance(value: unknown): value is Spring2DRefWithInstance {
  return typeof value === 'object' && value !== null && Spring2DInstanceKey in value
}

// ── useSpring2D ─────────────────────────────────────────────────────

export function useSpring2D(
  target: MaybeRefOrGetter<Vector2>,
  options?: UseSpringOptions,
): SpringRef2D
export function useSpring2D(
  target: SpringRef2D,
  options?: UseSpringOptions,
): SpringRef2D
export function useSpring2D<const T extends readonly MaybeRefOrGetter<Vector2>[]>(
  targets: T,
  options?: UseSpringOptions,
): { [K in keyof T]: SpringRef2D }
export function useSpring2D(
  target: MaybeRefOrGetter<Vector2> | SpringRef2D | readonly MaybeRefOrGetter<Vector2>[],
  options?: UseSpringOptions,
): SpringRef2D | SpringRef2D[] {
  if (Array.isArray(target)) {
    return Array.from(target as MaybeRefOrGetter<Vector2>[], (t) =>
      createSpringRef2D(t, options),
    )
  }
  if (hasSpring2DInstance(target)) {
    return createLinkedSpringRef2D(target, options)
  }
  return createSpringRef2D(target as MaybeRefOrGetter<Vector2>, options)
}

function createSpringRef2D(
  target: MaybeRefOrGetter<Vector2>,
  options: UseSpringOptions | undefined,
): SpringRef2D {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const config = computed(() => {
    const opts = toValue(options)
    if (opts instanceof SpringConfig) return opts
    return opts ? new SpringConfig(opts) : undefined
  })

  const spring = system.createSpring2D(toValue(target), config.value ?? undefined)

  watchSyncEffect(() => {
    const c = config.value
    if (c) {
      spring.config = c
    } else {
      spring.config = null
    }
  })

  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })

  const value = customRef((track, trigger) => ({
    get() {
      triggerValue ??= trigger
      track()
      return spring.value
    },
    set(value: Vector2) {
      spring.value = value
      trigger()
    },
  }))

  const velocity = customRef((track, trigger) => ({
    get() {
      triggerVelocity ??= trigger
      track()
      return spring.velocity
    },
    set(value: Vector2) {
      spring.velocity = value
      trigger()
    },
  }))

  const timeRemaining = customRef((track, trigger) => ({
    get() {
      triggerTimeRemaining ??= trigger
      track()
      return spring.timeRemaining
    },
    set() {},
  }))

  const isResting = customRef((track, trigger) => {
    spring.onStart(trigger)
    spring.onStop(trigger)

    return {
      get() {
        track()
        return spring.isResting
      },
      set() {},
    }
  })

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  if (getCurrentScope()) {
    onScopeDispose(() => spring.dispose())
  }

  const ref = Object.assign(value, {
    velocity,
    timeRemaining,
    isResting,
    jumpTo: (value: Vector2) => spring.jumpTo(value),
  }) as SpringRef2D

  Object.defineProperty(ref, Spring2DInstanceKey, { value: spring })

  return ref
}

function createLinkedSpringRef2D(
  leaderRef: Spring2DRefWithInstance,
  options: UseSpringOptions | undefined,
): SpringRef2D {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const leaderSpring = leaderRef[Spring2DInstanceKey]

  const config = computed(() => {
    const opts = toValue(options)
    if (!opts) return undefined
    if (opts instanceof SpringConfig) return opts
    return new SpringConfig(opts)
  })

  const spring = system.createSpring2D({ target: leaderSpring }, config.value)

  watchSyncEffect(() => {
    const c = config.value
    if (c) {
      spring.config = c
    } else {
      spring.config = null
    }
  })

  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  spring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })

  const value = customRef((track, trigger) => ({
    get() {
      triggerValue ??= trigger
      track()
      return spring.value
    },
    set(value: Vector2) {
      spring.value = value
      trigger()
    },
  }))

  const velocity = customRef((track, trigger) => ({
    get() {
      triggerVelocity ??= trigger
      track()
      return spring.velocity
    },
    set(value: Vector2) {
      spring.velocity = value
      trigger()
    },
  }))

  const timeRemaining = customRef((track, trigger) => ({
    get() {
      triggerTimeRemaining ??= trigger
      track()
      return spring.timeRemaining
    },
    set() {},
  }))

  const isResting = customRef((track, trigger) => {
    spring.onStart(trigger)
    spring.onStop(trigger)

    return {
      get() {
        track()
        return spring.isResting
      },
      set() {},
    }
  })

  if (getCurrentScope()) {
    onScopeDispose(() => spring.dispose())
  }

  const ref = Object.assign(value, {
    velocity,
    timeRemaining,
    isResting,
    jumpTo: (value: Vector2) => spring.jumpTo(value),
  }) as SpringRef2D

  Object.defineProperty(ref, Spring2DInstanceKey, { value: spring })

  return ref
}
