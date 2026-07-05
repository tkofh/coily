import { type MaybeRefOrGetter, toValue, watchSyncEffect } from 'vue'
import type { Spring } from '../spring.ts'
import {
  type ReactiveSpringRef,
  type UseSpringOptions,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
} from './reactive-spring.ts'

export type { UseSpringOptions } from './reactive-spring.ts'

// ── SpringRef ───────────────────────────────────────────────────────

export interface SpringRef extends ReactiveSpringRef<number> {}

/** @internal Symbol to access the underlying Spring from a SpringRef */
const SpringInstanceKey = Symbol('spring')

type SpringRefWithInstance = SpringRef & { [SpringInstanceKey]: Spring }

function hasSpringInstance(value: unknown): value is SpringRefWithInstance {
  return typeof value === 'object' && value !== null && SpringInstanceKey in value
}

// ── useSpring ───────────────────────────────────────────────────────

export function useSpring(target: MaybeRefOrGetter<number>, options?: UseSpringOptions): SpringRef
export function useSpring(target: SpringRef, options?: UseSpringOptions): SpringRef
export function useSpring<const T extends readonly MaybeRefOrGetter<number>[]>(
  targets: T,
  options?: UseSpringOptions,
): { [K in keyof T]: SpringRef }
export function useSpring(
  target: MaybeRefOrGetter<number> | SpringRef | readonly MaybeRefOrGetter<number>[],
  options?: UseSpringOptions,
): SpringRef | SpringRef[] {
  if (Array.isArray(target)) {
    return Array.from(target as MaybeRefOrGetter<number>[], (t) => createSpringRef(t, options))
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
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  const spring = system.createSpring(toValue(target), config.value)
  const ref = createReactiveSpringRef(spring, config, SpringInstanceKey)

  watchSyncEffect(() => {
    spring.target = toValue(target)
  })

  return ref
}

function createLinkedSpringRef(
  leaderRef: SpringRefWithInstance,
  options: UseSpringOptions | undefined,
): SpringRef {
  const system = injectSpringSystem()
  const config = resolveSpringConfig(options)
  const spring = system.createSpring({ target: leaderRef[SpringInstanceKey] }, config.value)
  return createReactiveSpringRef(spring, config, SpringInstanceKey)
}
