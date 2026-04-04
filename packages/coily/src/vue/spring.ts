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
import type { SpringBase } from '../spring.ts'
import { SpringSystemKey } from './system.ts'

export interface SpringRef extends Ref<number> {
  readonly velocity: Ref<number>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  readonly jumpTo: (value: number) => void
}

export interface LinkedSpringRef extends Ref<number> {
  readonly velocity: Ref<number>
  readonly timeRemaining: Ref<number>
  readonly isResting: Ref<boolean>
  readonly jumpTo: (value: number) => void
  readonly offset: Ref<number>
}

export const defaultOptions = {
  tension: 100,
  damping: 10,
  precision: 2,
} satisfies SpringOptions

type UseSpringOptions = MaybeRefOrGetter<SpringOptions | SpringConfig | undefined>

/** @internal Symbol to access the underlying Spring instance from a SpringRef */
const SpringInstanceKey = Symbol('spring')

type SpringRefWithInstance = SpringRef & { [SpringInstanceKey]: SpringBase }

function hasSpringInstance(value: unknown): value is SpringRefWithInstance {
  return typeof value === 'object' && value !== null && SpringInstanceKey in value
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
    return new SpringConfig(opts ?? defaultOptions)
  })

  const spring = system.createSpring(toValue(target), config.value)

  watchSyncEffect(() => {
    spring.configure(config.value)
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
): LinkedSpringRef {
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

  const linkedSpring = system.createSpring({ target: leaderSpring }, config.value)

  watchSyncEffect(() => {
    const c = config.value
    if (c) {
      linkedSpring.configure(c)
    } else {
      linkedSpring.clearConfigOverride()
    }
  })

  let triggerValue: (() => void) | undefined
  let triggerVelocity: (() => void) | undefined
  let triggerTimeRemaining: (() => void) | undefined

  linkedSpring.onUpdate(() => {
    triggerValue?.()
    triggerVelocity?.()
    triggerTimeRemaining?.()
  })

  const value = customRef((track, trigger) => ({
    get() {
      triggerValue ??= trigger
      track()
      return linkedSpring.value
    },
    set(value: number) {
      linkedSpring.value = value
      trigger()
    },
  }))

  const velocity = customRef((track, trigger) => ({
    get() {
      triggerVelocity ??= trigger
      track()
      return linkedSpring.velocity
    },
    set(value: number) {
      linkedSpring.velocity = value
      trigger()
    },
  }))

  const timeRemaining = customRef((track, trigger) => ({
    get() {
      triggerTimeRemaining ??= trigger
      track()
      return linkedSpring.timeRemaining
    },
    set() {},
  }))

  const isResting = customRef((track, trigger) => {
    linkedSpring.onStart(trigger)
    linkedSpring.onStop(trigger)

    return {
      get() {
        track()
        return linkedSpring.isResting
      },
      set() {},
    }
  })

  const offset = customRef((track, trigger) => ({
    get() {
      track()
      return linkedSpring.offset
    },
    set(value: number) {
      linkedSpring.offset = value
      trigger()
    },
  }))

  if (getCurrentScope()) {
    onScopeDispose(() => linkedSpring.dispose())
  }

  const ref = Object.assign(value, {
    velocity,
    timeRemaining,
    isResting,
    jumpTo: (value: number) => linkedSpring.jumpTo(value),
    offset,
  }) as LinkedSpringRef

  Object.defineProperty(ref, SpringInstanceKey, { value: linkedSpring })

  return ref
}

export function useSpring(target: MaybeRefOrGetter<number>, options?: UseSpringOptions): SpringRef
export function useSpring(target: SpringRef | LinkedSpringRef, options?: UseSpringOptions): LinkedSpringRef
export function useSpring<const T extends readonly MaybeRefOrGetter<number>[]>(
  targets: T,
  options?: UseSpringOptions,
): { [K in keyof T]: SpringRef }
export function useSpring(
  target:
    | MaybeRefOrGetter<number>
    | SpringRef
    | LinkedSpringRef
    | readonly MaybeRefOrGetter<number>[],
  options?: UseSpringOptions,
): SpringRef | LinkedSpringRef | SpringRef[] {
  if (Array.isArray(target)) {
    return Array.from(target as MaybeRefOrGetter<number>[], (t) => createSpringRef(t, options))
  }
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(target, options)
  }
  return createSpringRef(target as MaybeRefOrGetter<number>, options)
}
