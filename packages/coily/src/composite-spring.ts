import { SpringDefinition } from './config.ts'
import { Emitter } from './emitter.ts'
import type { MotionSet } from './motion-set.ts'
import {
  BRANCH,
  ShapeTree,
  ShapeView,
  type Coverage,
  acceptNumber,
  channelParser,
  describePath,
} from './shape-tree.ts'
import { Spring, type Purpose } from './spring.ts'
import { type SpringSource, SpringSourceSymbol, isSpringSource } from './spring-source.ts'
import type { TargetedSource, TargetedSourceApi } from './kinematic-source.ts'
import { registerBacking } from './follow-graph.ts'
import { invariant, isNumber, isRecordOrArray, RESOLVED } from './util.ts'

/**
 * Compile-time validation of a value shape: every channel must be a `number`,
 * every branch a plain object or array with at least one channel. Used as
 * `value: T & Shape<T>` so an invalid channel errors on that property rather
 * than on the whole argument. It is purely structural, so interfaces
 * satisfy it without index signatures, and runtime validation mirrors it
 * for untyped callers. Optional and `undefined`-typed channels
 * are rejected: a channel that may be absent would make two springs of the
 * same declared shape structurally incompatible at runtime.
 */
export type Shape<T> = 0 extends 1 & T
  ? T // any defers wholly to the runtime checks
  : T extends number
    ? number
    : T extends ((...args: never) => unknown) | (abstract new (...args: never) => unknown)
      ? never
      : T extends readonly never[]
        ? never
        : T extends object
          ? keyof T extends never
            ? never
            : {
                [K in keyof T]-?: 0 extends 1 & T[K]
                  ? T[K]
                  : undefined extends T[K]
                    ? never
                    : Shape<T[K]>
              }
          : never

/**
 * A partial view of a value shape: the same nesting with any subset of the
 * numeric channels present. A write leaves absent or `undefined` channels
 * unchanged.
 */
export type PartialShape<T> = T extends number
  ? number
  : { readonly [K in keyof T]?: PartialShape<T[K]> | undefined }

/**
 * A deep-readonly view of a value shape. Composite reads (`target`, `value`,
 * `velocity`, `acceleration`) return the spring's live mirror objects, and
 * every read refreshes them in place, so their channels are typed read-only.
 */
export type ReadonlyShape<T> = T extends number
  ? number
  : { readonly [K in keyof T]: ReadonlyShape<T[K]> }

/**
 * Configuration for a composite spring: a single `SpringDefinition` applied to every
 * channel, or an object mirroring the value shape with configs at any level.
 * A config at a subtree applies to every channel below it.
 * `null` reverts to the default config.
 * Configs are always `SpringDefinition` instances (from `defineSpring`), so a
 * plain object is unambiguously a config shape and any non-config leaf it
 * reaches is an error.
 */
export type ConfigShape<T> =
  | SpringDefinition
  | null
  | (T extends number ? never : { readonly [K in keyof T]?: ConfigShape<T[K]> | undefined })

/**
 * What each channel of a composite spring animates: a single `Purpose`
 * for every channel, or a shape mirroring the value with purposes at any
 * level. A purpose at a subtree covers every channel below it, and a
 * channel that no purpose reaches defaults to `'motion'`. The purposes
 * are fixed when the spring is created. See `Purpose`.
 */
export type PurposeShape<T> =
  | Purpose
  | (T extends number ? never : { readonly [K in keyof T]?: PurposeShape<T[K]> | undefined })

/**
 * A partial target shape: the same nesting as the value with any subset
 * of the channels present, each taking a number to animate toward or a
 * scalar `SpringSource` to follow. A write leaves absent or `undefined`
 * channels unchanged.
 */
export type TargetShape<T> = T extends number
  ? number | SpringSource
  : { readonly [K in keyof T]?: TargetShape<T[K]> | undefined }

/**
 * What a composite spring can animate toward: a partial shape mixing
 * numbers and scalar `SpringSource`s per channel, or another composite
 * spring of the same shape to follow channel by channel.
 */
export type CompositeSpringTarget<T extends object> = TargetShape<T> | CompositeSpring<T>

// ── Config resolution ───────────────────────────────────────────────

function invalidConfig(path: string): string {
  return `Invalid config for ${describePath(path)}: expected a SpringDefinition, null, or a config shape matching the value`
}

/**
 * Decides what a config node means. `null` and `SpringDefinition` instances
 * are configs that cover the whole subtree. Any other object or array is a
 * config shape to descend into, and the descent checks its structure. A
 * bare options object is such a shape, so its option keys fail as unknown
 * channels. Anything else, such as a bare number or string, is invalid.
 */
function resolveConfigNode(node: unknown, path: string): Coverage<SpringDefinition | null> {
  if (node === null) return null
  if (node instanceof SpringDefinition) return node
  if (isRecordOrArray(node)) return BRANCH
  throw new Error(invalidConfig(path))
}

// ── Purpose resolution ──────────────────────────────────────────────

function invalidPurpose(path: string): string {
  return `Invalid purpose for ${describePath(path)}: expected 'motion', 'nonmotion', or a purpose shape matching the value`
}

/**
 * Decides what a purpose node means: a `Purpose` string covers the whole
 * subtree, any object or array is a purpose shape to descend into, and
 * anything else is invalid.
 */
function resolvePurposeNode(node: unknown, path: string): Coverage<Purpose> {
  if (node === 'motion' || node === 'nonmotion') return node
  if (isRecordOrArray(node)) return BRANCH
  throw new Error(invalidPurpose(path))
}

// ── Channel operations ──────────────────────────────────────────────

const readTarget = (spring: Spring) => spring.target
const readValue = (spring: Spring) => spring.value
const readVelocity = (spring: Spring) => spring.velocity
const readAcceleration = (spring: Spring) => spring.acceleration

/**
 * The target scatter's leaf guard: a channel animates toward a number,
 * or follows a scalar source. Checked here so the error carries the
 * channel's path.
 */
function acceptChannelTarget(input: unknown, path: string): number | SpringSource {
  invariant(
    (isNumber(input) && Number.isFinite(input)) ||
      (isSpringSource(input) && typeof input[SpringSourceSymbol].value === 'number'),
    () => `Invalid value at '${path}': expected a finite number or a scalar SpringSource`,
  )
  return input as SpringSource
}

const assignTarget = (spring: Spring, value: number | SpringSource) => {
  spring.target = value
}
const assignValue = (spring: Spring, value: number) => {
  spring.value = value
}
const assignVelocity = (spring: Spring, value: number) => {
  spring.velocity = value
}
const applyJump = (spring: Spring, value: number) => {
  spring.jumpTo(value)
}
const assignConfig = (spring: Spring, config: SpringDefinition | null) => {
  spring.config = config
}
const followChannel = (mine: Spring, theirs: Spring) => {
  mine.target = theirs
}

/**
 * A composite spring over a fixed numeric shape: a nested plain object
 * or array whose leaves are all numbers. Each leaf runs an independent
 * spring, called a channel, behind one API. Targets, values, velocities,
 * and configs read and write as shapes, writes can name any subset of
 * the channels, and events coalesce across channels. Create composite
 * springs with `SpringSystem.createSpring`.
 *
 * A composite spring is a `SpringSource` of its value shape. Springs can
 * follow only scalar sources, so use `mapSpring` to derive one from the
 * composite, alone or at the leaves of a shape.
 *
 * The shape is fixed at construction. A write that names an unknown
 * channel throws with the channel's path (`position.z`), and so does a
 * non-finite channel value.
 */
export class CompositeSpring<in out T extends object> implements TargetedSource<ReadonlyShape<T>> {
  /** Brands the composite as a `TargetedSource` whose api is the composite itself. */
  get [SpringSourceSymbol](): TargetedSourceApi<ReadonlyShape<T>> {
    // Backing registers on first use as a source. `Spring`'s brand getter
    // explains why registration is lazy.
    registerBacking(this, this.#tree.leaves)
    return this
  }

  readonly #motions: MotionSet
  readonly #tree: ShapeTree<Spring>
  readonly #valueView: ShapeView<Spring>
  // Built on first read. `value` is the hot read (one per frame), so only
  // its view is eager. A composite that never reads its target, velocity,
  // or acceleration never allocates those mirrors.
  #targetView: ShapeView<Spring> | null = null
  #velocityView: ShapeView<Spring> | null = null
  #accelerationView: ShapeView<Spring> | null = null

  readonly #emitter = new Emitter()
  #running = false
  #dirty = false

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  // One flush runs per write batch or tick. It emits the coalesced update
  // before stop, so a stop always comes after the frame's final update.
  readonly #flush = () => {
    if (this.#disposed) return

    if (this.#dirty) {
      this.#dirty = false
      this.#emitter.emit('update')
    }

    if (this.#running) {
      if (this.isResting) {
        this.#running = false
        this.#emitter.emit('stop')
      }
    } else if (!this.isResting) {
      this.#running = true
      this.#emitter.emit('start')
    }

    // A composite that leaves rest and returns within one batch emits
    // neither `start` nor `stop`, so `settled` resolves on the state the
    // flush finds, not on the event.
    const resolve = this.#resolveSettled
    if (resolve !== null && !this.#running) {
      this.#settled = null
      this.#resolveSettled = null
      resolve()
    }
  }

  constructor(
    motions: MotionSet,
    value: T & Shape<T>,
    config?: ConfigShape<T>,
    purpose?: PurposeShape<T>,
  ) {
    this.#motions = motions

    invariant(
      isRecordOrArray(value),
      'Composite spring value must be a plain object or an array of numeric channels',
    )

    // A channel spring's purpose is fixed at construction (it has no
    // setter), so the shape must resolve to a per-channel purpose before
    // the springs exist. A throwaway tree of channel paths reuses the
    // cover, descend, and validation logic of `broadcast`. Without a
    // purpose, the constructor skips this step.
    let purposeByPath: Map<string, Purpose> | null = null
    if (purpose !== undefined) {
      const byPath = new Map<string, Purpose>()
      const paths = new ShapeTree(
        value,
        channelParser((_leafValue, path) => path),
      )
      paths.root.broadcast(purpose, resolvePurposeNode, (path, p) => byPath.set(path, p), 'purpose')
      purposeByPath = byPath
    }

    this.#tree = new ShapeTree(
      value,
      channelParser(
        (leafValue, path) =>
          new Spring(motions, leafValue, undefined, purposeByPath?.get(path) ?? 'motion'),
      ),
    )
    if (config !== undefined) {
      this.#tree.root.broadcast(config, resolveConfigNode, assignConfig, 'config')
    }

    this.#valueView = new ShapeView(this.#tree.root, readValue)

    const markDirty = () => {
      this.#dirty = true
      this.#motions.flushes.request(this.#flush)
    }
    const schedule = () => {
      this.#motions.flushes.request(this.#flush)
    }
    for (const channel of this.#tree.leaves) {
      channel.onUpdate(markDirty)
      channel.onStart(schedule)
      channel.onStop(schedule)
    }
  }

  /**
   * The value each channel is animating toward, as a read-only mirror of
   * the shape. The mirror object is reused. Every read refreshes its
   * numbers in place, so read it fresh instead of holding it across
   * frames.
   *
   * Assignment accepts a `CompositeSpringTarget`:
   * - A partial shape retargets the channels it names and leaves the
   *   others alone. Each named channel takes a number, or a scalar
   *   `SpringSource` to follow, such as a `Spring` or a value derived
   *   with `mapSpring`. While the composite follows a leader, naming a
   *   channel also detaches that channel from the leader.
   * - A `CompositeSpring` of the same shape becomes the leader, and each
   *   channel follows the matching leader channel.
   *
   * Unknown channels throw with their path. Under reduced motion,
   * retargets apply instantly, except on channels whose `purpose` is
   * `'nonmotion'`.
   */
  get target(): ReadonlyShape<T> {
    const view = (this.#targetView ??= new ShapeView(this.#tree.root, readTarget))
    view.refresh()
    return view.root as ReadonlyShape<T>
  }

  set target(value: CompositeSpringTarget<T>) {
    this.#assertLive()
    if (value instanceof CompositeSpring) {
      this.#follow(value)
    } else {
      this.#motions.flushes.batch(() => {
        this.#tree.root.scatter(value, acceptChannelTarget, assignTarget)
      })
    }
  }

  /**
   * The current animated value of every channel, as a read-only mirror of
   * the shape. The mirror object is reused. Every read refreshes its
   * numbers in place, so read it fresh instead of holding it across
   * frames.
   *
   * Assignment takes a partial shape and displaces the channels it names.
   * Each named channel keeps its target and springs back from the written
   * value, and the write fires one coalesced `update` synchronously. Under
   * reduced motion, a write jumps the named channels to the written
   * values, targets included. Channels whose `purpose` is `'nonmotion'`
   * still displace as normal.
   */
  get value(): ReadonlyShape<T> {
    this.#valueView.refresh()
    return this.#valueView.root as ReadonlyShape<T>
  }

  set value(value: PartialShape<T>) {
    this.#assertLive()
    this.#motions.flushes.batch(() => {
      this.#tree.root.scatter(value, acceptNumber, assignValue)
    })
  }

  /**
   * The current velocity of every channel in value units per second, as a
   * read-only mirror of the shape. The mirror is reused and refreshed in
   * place on each read.
   *
   * Assignment takes a partial shape and flings the channels it names.
   * The other channels are unchanged. Under reduced motion, writes are
   * ignored, except on channels whose `purpose` is `'nonmotion'`.
   */
  get velocity(): ReadonlyShape<T> {
    const view = (this.#velocityView ??= new ShapeView(this.#tree.root, readVelocity))
    view.refresh()
    return view.root as ReadonlyShape<T>
  }

  set velocity(value: PartialShape<T>) {
    this.#assertLive()
    this.#motions.flushes.batch(() => {
      this.#tree.root.scatter(value, acceptNumber, assignVelocity)
    })
  }

  /**
   * The current acceleration of every channel in value units per second
   * squared, as a read-only mirror of the shape. The mirror is reused and
   * refreshed in place on each read. Acceleration follows from the motion,
   * so it has no setter here, as on each channel. To fling channels,
   * write `velocity`.
   */
  get acceleration(): ReadonlyShape<T> {
    const view = (this.#accelerationView ??= new ShapeView(this.#tree.root, readAcceleration))
    view.refresh()
    return view.root as ReadonlyShape<T>
  }

  /**
   * The shared config when every channel resolves to the same
   * `SpringDefinition`, and `null` when they differ.
   *
   * Assignment accepts a `ConfigShape`: one config for every channel,
   * `null` to revert every channel to the default, or a shape mirroring
   * the value with configs at any level. A config at a subtree covers
   * every channel below it. Non-config leaves throw with their path.
   *
   * A `null` read means the channels differ. Assigning that `null` back
   * reverts every channel to the default.
   */
  get config(): SpringDefinition | null {
    const channels = this.#tree.leaves
    const first = channels[0]!.config
    for (let i = 1; i < channels.length; i++) {
      if (channels[i]!.config !== first) return null
    }
    return first
  }

  set config(value: ConfigShape<T>) {
    this.#assertLive()
    this.#motions.flushes.batch(() => {
      this.#tree.root.broadcast(value ?? null, resolveConfigNode, assignConfig, 'config')
    })
  }

  /**
   * The shared purpose when every channel resolves to the same `Purpose`,
   * and `null` when they differ. The purposes are fixed when the spring is
   * created. A `'nonmotion'` channel opts out of reduced motion. See
   * `Purpose`.
   */
  get purpose(): Purpose | null {
    const channels = this.#tree.leaves
    const first = channels[0]!.purpose
    for (let i = 1; i < channels.length; i++) {
      if (channels[i]!.purpose !== first) return null
    }
    return first
  }

  /** The largest `timeRemaining` across channels, in ms. */
  get timeRemaining(): number {
    let max = 0
    for (const channel of this.#tree.leaves) {
      const remaining = channel.timeRemaining
      if (remaining > max) max = remaining
    }
    return max
  }

  /** Whether every channel is resting. */
  get isResting(): boolean {
    for (const channel of this.#tree.leaves) {
      if (!channel.isResting) return false
    }
    return true
  }

  /**
   * A promise that resolves when every channel next rests. It is already
   * resolved while the composite rests or after dispose. Retargeting any
   * channel mid-flight extends the wait, and disposing resolves it.
   */
  get settled(): Promise<void> {
    if (this.#disposed || this.isResting) return RESOLVED

    this.#settled ??= new Promise((resolve) => {
      this.#resolveSettled = resolve
    })

    return this.#settled
  }

  /**
   * Snaps the channels that the partial shape names to the given values,
   * with no animation: each named channel's target and value both become
   * the given value. The composite fires one `update` synchronously, plus
   * `stop` if the jump leaves every channel resting. Channels that the
   * shape leaves out are unchanged.
   */
  jumpTo(value: PartialShape<T>) {
    this.#assertLive()
    this.#motions.flushes.batch(() => {
      this.#tree.root.scatter(value, acceptNumber, applyJump)
    })
  }

  /**
   * Releases every channel permanently. Each channel stops following, and
   * its followers detach and keep their current targets. `settled`
   * resolves and dispose listeners fire. Calling it again is a no-op.
   *
   * A disposed composite spring keeps its final values readable. Writes
   * throw.
   */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true

    if (this.#resolveSettled) {
      this.#resolveSettled()
      this.#settled = null
      this.#resolveSettled = null
    }

    for (const channel of this.#tree.leaves) {
      channel.dispose()
    }
    this.#emitter.clear()
  }

  /**
   * Subscribes to coalesced value changes. The composite fires at most one
   * `update` per tick, after every channel advances. It also fires one for
   * each synchronous write that moves a channel, such as a `value` write
   * or a `jumpTo` call. Returns an unsubscribe function.
   */
  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  /**
   * Subscribes to the composite leaving rest. `start` fires when a channel
   * starts to move and no other channel was moving. It always alternates
   * with `stop`. Returns an unsubscribe function.
   */
  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  /**
   * Subscribes to the composite coming to rest. `stop` fires when every
   * channel rests, after that tick's final `update`. It always alternates
   * with `start`. Returns an unsubscribe function.
   */
  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  /** Subscribes to `dispose`, which fires once. Returns an unsubscribe function. */
  onDispose(callback: () => void) {
    // Channels dispose together, so the composite uses the first
    // channel's dispose event as its own.
    return this.#tree.leaves[0]!.onDispose(callback)
  }

  #assertLive() {
    invariant(!this.#disposed, 'Cannot write to a disposed spring')
  }

  #follow(leader: CompositeSpring<T>) {
    this.#motions.flushes.batch(() => {
      this.#tree.root.zip(leader.#tree.root, followChannel)
    })
  }
}
