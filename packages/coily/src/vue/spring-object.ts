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

/**
 * Reactive config for a spring object: anything `ConfigShape` accepts — a
 * single config, spring options, `null`, or a shape mirroring the value
 * with configs at any level — optionally behind a ref or getter.
 */
export type UseSpringObjectOptions<T extends object> = MaybeRefOrGetter<ConfigShape<T> | undefined>

// ── SpringObjectRef ─────────────────────────────────────────────────

export interface SpringObjectRef<T extends object> extends ReactiveSpringRef<
  ReadonlyShape<T>,
  PartialShape<T>
> {}

/** @internal Symbol to access the underlying SpringObject from a SpringObjectRef */
const SpringObjectInstanceKey = Symbol('spring-object')

/**
 * The impl-side stand-in for "some shape": `useSpring`'s public overloads
 * bind the real `T`, dispatch code only needs a shape type that survives
 * `Shape<T>` (unlike `object`, whose empty key set resolves it to `never`).
 */
export type AnyShape = Record<string, number>

type SpringObjectRefWithInstance<T extends object> = SpringObjectRef<T> & {
  [SpringObjectInstanceKey]: SpringObject<T>
}

export function hasSpringObjectInstance(
  value: unknown,
): value is SpringObjectRefWithInstance<AnyShape> {
  return typeof value === 'object' && value !== null && SpringObjectInstanceKey in value
}

// ── Spring object refs (creation dispatch lives in useSpring) ──────

function resolveConfigShape<T extends object>(
  options: UseSpringObjectOptions<T> | undefined,
): ComputedRef<ConfigShape<T> | undefined> {
  // Unlike scalar options, config shapes need no conversion — the spring
  // object classifies them (config vs options vs per-channel) itself.
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

  // Retargets track deeply: the target setter reads each channel of the
  // (possibly reactive) input inside this effect.
  watchSyncEffect(() => {
    // A full value shape is a valid partial retarget; TS cannot relate the
    // two mapped types while T is unresolved.
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
  // Created at the leader's current value (the mirror is copied, never
  // aliased), then follows — matching scalar linked-spring semantics.
  const spring = system.createSpringObject<T>(leader.value as unknown as T & Shape<T>, config.value)
  spring.target = leader
  return createReactiveSpringRef<ReadonlyShape<T>, PartialShape<T>, ConfigShape<T>>(
    spring,
    config,
    SpringObjectInstanceKey,
  )
}
