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
import { SpringConfig, type SpringOptions } from '../config.ts'
import { Spring } from '../spring.ts'
import { Spring2D } from '../spring2d.ts'
import type { Vector2 } from '../vector2.ts'
import { SpringSystemKey } from './system.ts'

type UseSpringOptions = MaybeRefOrGetter<SpringOptions | SpringConfig | undefined>

// ── SpringRef ───────────────────────────────────────────────────────

export interface SpringRef extends Ref<number> {
  readonly velocity: Ref<number>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  readonly jumpTo: (value: number) => void
}

/** @internal Symbol to access the underlying Spring from a SpringRef */
const SpringInstanceKey = Symbol('spring')

type SpringRefWithInstance = SpringRef & { [SpringInstanceKey]: Spring }

function hasSpringInstance(value: unknown): value is SpringRefWithInstance {
  return typeof value === 'object' && value !== null && SpringInstanceKey in value
}

// ── useSpring ───────────────────────────────────────────────────────

export function useSpring(
  target: MaybeRefOrGetter<number>,
  options?: UseSpringOptions,
): SpringRef
export function useSpring(
  target: SpringRef,
  options?: UseSpringOptions,
): SpringRef
export function useSpring<const T extends readonly MaybeRefOrGetter<number>[]>(
  targets: T,
  options?: UseSpringOptions,
): { [K in keyof T]: SpringRef }
export function useSpring(
  target: MaybeRefOrGetter<number> | SpringRef | readonly MaybeRefOrGetter<number>[],
  options?: UseSpringOptions,
): SpringRef | SpringRef[] {
  if (Array.isArray(target)) {
    return Array.from(target as MaybeRefOrGetter<number>[], (t) =>
      createSpringRef(t, options),
    )
  }
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(target, options)
  }
  return createSpringRef(target as MaybeRefOrGetter<number>, options)
}

function createSpringRef(
  target: MaybeRefOrGetter<number>,
  options: UseSpringOptions | undefined,
): SpringRef {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const config = computed(() => {
    const opts = toValue(options)
    if (opts instanceof SpringConfig) return opts
    return opts ? new SpringConfig(opts) : undefined
  })

  const spring = system.createSpring(toValue(target), config.value ?? undefined)

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
    set(value: number) {
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
    set(value: number) {
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
    jumpTo: (value: number) => spring.jumpTo(value),
  }) as SpringRef

  Object.defineProperty(ref, SpringInstanceKey, { value: spring })

  return ref
}

function createLinkedSpringRef(
  leaderRef: SpringRefWithInstance,
  options: UseSpringOptions | undefined,
): SpringRef {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const leaderSpring = leaderRef[SpringInstanceKey]

  const config = computed(() => {
    const opts = toValue(options)
    if (!opts) return undefined
    if (opts instanceof SpringConfig) return opts
    return new SpringConfig(opts)
  })

  const spring = system.createSpring({ target: leaderSpring }, config.value)

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
    set(value: number) {
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
    set(value: number) {
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
    jumpTo: (value: number) => spring.jumpTo(value),
  }) as SpringRef

  Object.defineProperty(ref, SpringInstanceKey, { value: spring })

  return ref
}

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
export function useSpring2D(
  target: MaybeRefOrGetter<Vector2> | SpringRef2D,
  options?: UseSpringOptions,
): SpringRef2D {
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
