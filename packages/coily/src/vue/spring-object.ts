import { type ComputedRef, type MaybeRefOrGetter, computed, toValue, watchSyncEffect } from 'vue'
import type {
  ConfigShape,
  PartialShape,
  ReadonlyShape,
  Shape,
  SpringObject,
} from '../spring-object.ts'
import {
  type ReactiveSpringRef,
  createReactiveSpringRef,
  injectSpringSystem,
} from './reactive-spring.ts'

export type UseSpringObjectOptions<T extends object> = MaybeRefOrGetter<ConfigShape<T> | undefined>

export interface SpringObjectRef<T extends object> extends ReactiveSpringRef<
  ReadonlyShape<T>,
  PartialShape<T>
> {}

/** @internal */
const SpringObjectInstanceKey = Symbol('spring-object')

export type AnyShape = Record<string, number>

type SpringObjectRefWithInstance<T extends object> = SpringObjectRef<T> & {
  [SpringObjectInstanceKey]: SpringObject<T>
}

export function hasSpringObjectInstance(
  value: unknown,
): value is SpringObjectRefWithInstance<AnyShape> {
  return typeof value === 'object' && value !== null && SpringObjectInstanceKey in value
}

function resolveConfigShape<T extends object>(
  options: UseSpringObjectOptions<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  return computed(() => toValue(options))
}

export function createSpringObjectRef<T extends object>(
  value: MaybeRefOrGetter<T & Shape<T>>,
  options: UseSpringObjectOptions<T> | undefined,
): SpringObjectRef<T> {
  const system = injectSpringSystem()
  const config = resolveConfigShape(options)
  const spring = system.createSpringObject<T>(toValue(value), config.value)
  const ref = createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    SpringObjectInstanceKey,
  )

  watchSyncEffect(() => {
    spring.target = toValue(value) as unknown as PartialShape<T>
  })

  return ref
}

export function createLinkedSpringObjectRef<T extends object>(
  leaderRef: SpringObjectRefWithInstance<T>,
  options: UseSpringObjectOptions<T> | undefined,
): SpringObjectRef<T> {
  const system = injectSpringSystem()
  const leader = leaderRef[SpringObjectInstanceKey]
  const config = resolveConfigShape(options)
  const spring = system.createSpringObject<T>(leader.value as unknown as T & Shape<T>, config.value)
  spring.target = leader
  return createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    SpringObjectInstanceKey,
  )
}
