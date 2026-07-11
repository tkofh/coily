import { type MaybeRefOrGetter, type Ref, toValue, watchSyncEffect } from 'vue'
import type { Shape } from '../spring-object.ts'
import type { Spring } from '../spring.ts'
import {
  type ReactiveSpringRef,
  type UseSpringOptions,
  createReactiveSpringRef,
  injectSpringSystem,
  resolveSpringConfig,
} from './reactive-spring.ts'
import {
  type AnyShape,
  type SpringObjectRef,
  type UseSpringObjectOptions,
  createLinkedSpringObjectRef,
  createSpringObjectRef,
  hasSpringObjectInstance,
} from './spring-object.ts'

export type { UseSpringOptions } from './reactive-spring.ts'

export interface SpringRef extends ReactiveSpringRef<number> {}

/** @internal */
const SpringInstanceKey = Symbol('spring')

type SpringRefWithInstance = SpringRef & { [SpringInstanceKey]: Spring }

function hasSpringInstance(value: unknown): value is SpringRefWithInstance {
  return typeof value === 'object' && value !== null && SpringInstanceKey in value
}

export function useSpring(target: MaybeRefOrGetter<number>, options?: UseSpringOptions): SpringRef
export function useSpring(target: SpringRef, options?: UseSpringOptions): SpringRef
export function useSpring<T extends object>(
  target: SpringObjectRef<T>,
  options?: UseSpringObjectOptions<T>,
): SpringObjectRef<T>
export function useSpring<T extends object>(
  target: T & Shape<T>,
  options?: UseSpringObjectOptions<T>,
): SpringObjectRef<T>
export function useSpring<T extends object>(
  target: Ref<T & Shape<T>>,
  options?: UseSpringObjectOptions<T>,
): SpringObjectRef<T>
export function useSpring<T extends object>(
  target: () => T & Shape<T>,
  options?: UseSpringObjectOptions<T>,
): SpringObjectRef<T>
export function useSpring(
  target: unknown,
  options?: unknown,
): SpringRef | SpringObjectRef<AnyShape> {
  if (hasSpringInstance(target)) {
    return createLinkedSpringRef(target, options as UseSpringOptions)
  }
  if (hasSpringObjectInstance(target)) {
    return createLinkedSpringObjectRef(target, options as UseSpringObjectOptions<AnyShape>)
  }
  if (typeof toValue(target as MaybeRefOrGetter<unknown>) === 'number') {
    return createSpringRef(target as MaybeRefOrGetter<number>, options as UseSpringOptions)
  }
  return createSpringObjectRef(
    target as MaybeRefOrGetter<AnyShape>,
    options as UseSpringObjectOptions<AnyShape>,
  )
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
