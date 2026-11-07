/**
 * Type-level tests for the public entry points: every type that appears
 * in a public signature can be imported by name.
 *
 * This file is compiled by `tsc` but never executed (vitest only picks up
 * `*.spec.ts`, `*.browser.ts`, and `*.bench.ts`). An import that stops
 * resolving fails the typecheck.
 */
import {
  SpringDefinition,
  SpringSourceSymbol,
  defineSpring,
  mapSpring,
  targetOf,
  velocityOf,
  type CompositeSpring,
  type KinematicSourceApi,
  type PartialShape,
  type ReadonlyShape,
  type Shape,
  type SourceShape,
  type SourceValues,
  type Spring,
  type SpringSource,
  type SpringSourceApi,
  type SpringSystem,
  type TargetShape,
  type TargetedSource,
  type TargetedSourceApi,
} from '../src/index.ts'
import type {
  SpringValueSlotScope,
  UseCompositeSpringConfig,
  UseSpringConfig,
} from '../src/vue/index.ts'

declare const system: SpringSystem
declare const spring: Spring
declare const point: CompositeSpring<{ x: number; y: number }>

// ── `SpringDefinition` is a value export ─────────────────────────────

const fallback: SpringDefinition = SpringDefinition.default
const built: boolean = defineSpring({ dampingRatio: 1, duration: 300 }) instanceof SpringDefinition
void fallback
void built

// ── Shape types name composite reads, writes, and targets ───────────

interface Point {
  x: number
  y: number
}

function create<T extends object>(value: T & Shape<T>): CompositeSpring<T> {
  return system.createSpring(value)
}
create<Point>({ x: 0, y: 0 })

const read: ReadonlyShape<Point> = point.value
const write: PartialShape<Point> = { x: 10 }
const aim: TargetShape<Point> = { x: 10, y: spring }
point.value = write
point.target = aim
void read

// ── Source api types let you write a custom source ──────────────────

function constantSource(value: number): SpringSource {
  const api: SpringSourceApi = {
    value,
    onUpdate: () => () => {},
    onDispose: () => () => {},
  }
  return { [SpringSourceSymbol]: api }
}
spring.target = constantSource(5)

function fixedTarget(value: number): TargetedSource {
  const api: TargetedSourceApi = {
    value,
    velocity: 0,
    acceleration: 0,
    target: value,
    onUpdate: () => () => {},
    onDispose: () => () => {},
  }
  return { [SpringSourceSymbol]: api }
}
targetOf(fixedTarget(5))

const kinematic: KinematicSourceApi = spring[SpringSourceSymbol]
velocityOf(spring)
void kinematic

// ── `mapSpring` shape types name a shape of sources and its values ──

interface Axes {
  x: SpringSource
  y: SpringSource
}

const axes: Axes & SourceShape<Axes> = { x: spring, y: spring }
const length = (values: SourceValues<Axes>): number => Math.hypot(values.x, values.y)
mapSpring(axes, length)

// ── Vue config and slot types ────────────────────────────────────────

const scalarConfig: UseSpringConfig = { dampingRatio: 1, duration: 300 }
const compositeConfig: UseCompositeSpringConfig<Point> = { x: SpringDefinition.default }
const slot = (scope: SpringValueSlotScope): number => scope.value + scope.velocity
void scalarConfig
void compositeConfig
void slot
