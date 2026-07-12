import { SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import type { MotionSet } from './motion-set.ts'
import {
  BRANCH,
  ChannelTree,
  type ChannelView,
  type Coverage,
  describePath,
} from './channel-tree.ts'
import { Spring } from './spring.ts'
import { invariant, isRecord, isRecordOrArray } from './util.ts'

/**
 * Compile-time validation of a value shape: every channel must be a `number`,
 * every branch a plain object or array with at least one channel. Used as
 * `value: T & Shape<T>` so an invalid channel errors on that property rather
 * than on the whole argument. Purely structural — interfaces satisfy it
 * without index signatures — and mirrored by the runtime
 * validation for untyped callers. Optional and `undefined`-typed channels
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
 * numeric channels present. Absent (or `undefined`) channels are left alone.
 */
export type PartialShape<T> = T extends number
  ? number
  : { readonly [K in keyof T]?: PartialShape<T[K]> | undefined }

/**
 * A deep-readonly view of a value shape. Composite reads (`target`, `value`,
 * `velocity`) return the spring's live mirror objects — refreshed in place
 * on every read — so their channels are typed read-only.
 */
export type ReadonlyShape<T> = T extends number
  ? number
  : { readonly [K in keyof T]: ReadonlyShape<T[K]> }

/**
 * Configuration for a spring object: a single `SpringConfig` applied to every
 * channel, or an object mirroring the value shape with configs at any level.
 * A config at a subtree applies to every channel below it.
 * `null` reverts to the default config (or the leader's while following).
 * Configs are always `SpringConfig` instances (from `defineSpring`), so a
 * plain object is unambiguously a config shape and any non-config leaf it
 * reaches is an error.
 */
export type ConfigShape<T> =
  | SpringConfig
  | null
  | (T extends number ? never : { readonly [K in keyof T]?: ConfigShape<T[K]> | undefined })

/**
 * A channel-wise follow target: the spring object to track, plus optional
 * per-channel offsets.
 */
export interface SpringObjectWithOffset<T extends object> {
  /** The spring object whose channels to follow. Its shape must match exactly. */
  readonly spring: SpringObject<T>
  /**
   * A partial shape of constants added channel-wise to the leader's
   * values. Channels it leaves out follow at an offset of 0.
   */
  readonly offset?: PartialShape<T> | undefined
}

/**
 * What a spring object can animate toward: a partial shape of numbers,
 * or another spring object of the same shape — optionally with offsets —
 * to follow channel by channel.
 */
export type SpringObjectTarget<T extends object> =
  | PartialShape<T>
  | SpringObject<T>
  | SpringObjectWithOffset<T>

// ── Config resolution ───────────────────────────────────────────────

function invalidConfig(path: string): string {
  return `Invalid config for ${describePath(path)}: expected a SpringConfig, null, or a config shape matching the value`
}

/**
 * Decides what a config node means: `null` and `SpringConfig` instances are
 * configs covering the whole subtree, any other object or array is a config
 * shape to descend into (its structure is checked on the way down), and
 * anything else — a bare number, string, or options object — is invalid.
 */
function resolveConfigNode(node: unknown, path: string): Coverage<SpringConfig | null> {
  if (node === null) return null
  if (node instanceof SpringConfig) return node
  if (isRecordOrArray(node)) return BRANCH
  throw new Error(invalidConfig(path))
}

// ── Channel operations ──────────────────────────────────────────────

const readTarget = (spring: Spring) => spring.target
const readValue = (spring: Spring) => spring.value
const readVelocity = (spring: Spring) => spring.velocity

const assignTarget = (spring: Spring, value: number) => {
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
const assignConfig = (spring: Spring, config: SpringConfig | null) => {
  spring.config = config
}
const followChannel = (mine: Spring, theirs: Spring, offset: number | undefined) => {
  mine.target = offset ? { spring: theirs, offset } : theirs
}

// Shared so resting and disposed spring objects don't allocate a promise per read.
const RESOLVED = Promise.resolve()

/**
 * A composite spring over a fixed numeric shape — a nested plain object
 * or array whose leaves are all numbers. Each leaf runs an independent
 * spring, called a channel, behind one API: targets, values, velocities,
 * and configs read and write as (partial) shapes, and events are
 * coalesced across channels. Create spring objects with
 * `SpringSystem.createSpringObject`.
 *
 * The shape is fixed at construction. Writes naming unknown channels
 * throw with the channel's path (`position.z`).
 */
export class SpringObject<in out T extends object> {
  readonly #motions: MotionSet
  readonly #map: ChannelTree<Spring>
  readonly #targetView: ChannelView<Spring>
  readonly #valueView: ChannelView<Spring>
  readonly #velocityView: ChannelView<Spring>

  readonly #emitter = new Emitter()
  #running = false
  #dirty = false

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  // One flush per write batch or tick: the coalesced update is emitted
  // first, so a stop always lands after the frame's final update.
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
  }

  constructor(motions: MotionSet, value: T & Shape<T>, config?: ConfigShape<T>) {
    this.#motions = motions

    invariant(
      isRecordOrArray(value),
      'Spring object value must be a plain object or an array of numeric channels',
    )

    this.#map = new ChannelTree(value, (leafValue) => new Spring(motions, leafValue))
    if (config !== undefined) {
      this.#map.broadcast(config, resolveConfigNode, assignConfig, 'config')
    }

    this.#targetView = this.#map.createView(readTarget)
    this.#valueView = this.#map.createView(readValue)
    this.#velocityView = this.#map.createView(readVelocity)

    const markDirty = () => {
      this.#dirty = true
      this.#motions.flushes.request(this.#flush)
    }
    const schedule = () => {
      this.#motions.flushes.request(this.#flush)
    }
    for (const channel of this.#map.leaves) {
      channel.onUpdate(markDirty)
      channel.onStart(schedule)
      channel.onStop(schedule)
    }
  }

  /**
   * The value each channel is animating toward, as a read-only mirror of
   * the shape. The mirror object is reused: every read refreshes its
   * numbers in place, so read it fresh rather than holding it across
   * frames.
   *
   * Assignment accepts a `SpringObjectTarget`:
   * - A partial shape of numbers retargets the channels it names and
   *   leaves the others alone. While following, it also detaches the
   *   named channels from the leader.
   * - A `SpringObject` of the same shape — or `{ spring, offset }` with a
   *   partial offset shape — follows the leader channel by channel.
   *   Channels without a config of their own adopt the leader channel's.
   *
   * Unknown channels throw with their path.
   */
  get target(): ReadonlyShape<T> {
    this.#targetView.refresh()
    return this.#targetView.root as ReadonlyShape<T>
  }

  set target(value: SpringObjectTarget<T>) {
    if (value instanceof SpringObject) {
      this.#follow(value, undefined)
    } else if (
      isRecord(value) &&
      'spring' in value &&
      (value as unknown as SpringObjectWithOffset<T>).spring instanceof SpringObject
    ) {
      const { spring, offset } = value as unknown as SpringObjectWithOffset<T>
      this.#follow(spring, offset)
    } else {
      this.#motions.flushes.batch(() => {
        this.#map.scatter(value, assignTarget)
      })
    }
  }

  /**
   * The current animated value of every channel, as a read-only mirror of
   * the shape. The mirror object is reused: every read refreshes its
   * numbers in place, so read it fresh rather than holding it across
   * frames.
   *
   * Assignment takes a partial shape and displaces the channels it names:
   * each keeps its target and springs back from the written value, with
   * one coalesced `update` fired synchronously. Under reduced motion a
   * write jumps the named channels — targets included.
   */
  get value(): ReadonlyShape<T> {
    this.#valueView.refresh()
    return this.#valueView.root as ReadonlyShape<T>
  }

  set value(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, assignValue)
    })
  }

  /**
   * The current velocity of every channel in value units per second, as a
   * read-only mirror of the shape — reused and refreshed in place on each
   * read.
   *
   * Assignment takes a partial shape and flings the channels it names;
   * the rest are untouched. Under reduced motion writes are ignored.
   */
  get velocity(): ReadonlyShape<T> {
    this.#velocityView.refresh()
    return this.#velocityView.root as ReadonlyShape<T>
  }

  set velocity(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, assignVelocity)
    })
  }

  /**
   * The shared config when every channel resolves to the same
   * `SpringConfig`, and `null` when they differ.
   *
   * Assignment accepts a `ConfigShape`: one config for every channel,
   * `null` to revert every channel to the default (or to its leader
   * channel's, while following), or a shape mirroring the value with
   * configs at any level — a config at a subtree covers every channel
   * below it. Non-config leaves throw with their path.
   */
  get config(): SpringConfig | null {
    const channels = this.#map.leaves
    const first = channels[0]!.config
    for (let i = 1; i < channels.length; i++) {
      if (channels[i]!.config !== first) return null
    }
    return first
  }

  set config(value: ConfigShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.broadcast(value ?? null, resolveConfigNode, assignConfig, 'config')
    })
  }

  /** The largest `timeRemaining` across channels, in milliseconds. */
  get timeRemaining(): number {
    let max = 0
    for (const channel of this.#map.leaves) {
      const remaining = channel.timeRemaining
      if (remaining > max) max = remaining
    }
    return max
  }

  /** Whether every channel is resting. */
  get isResting(): boolean {
    for (const channel of this.#map.leaves) {
      if (!channel.isResting) return false
    }
    return true
  }

  /**
   * A promise that resolves when every channel next rests — already
   * resolved while resting or after dispose. Retargeting any channel
   * mid-flight extends the wait; disposing resolves it.
   */
  get settled(): Promise<void> {
    if (this.#disposed || this.isResting) return RESOLVED

    this.#settled ??= new Promise((resolve) => {
      this.#resolveSettled = resolve
      const unsubscribe = this.onStop(() => {
        unsubscribe()
        this.#settled = null
        this.#resolveSettled = null
        resolve()
      })
    })

    return this.#settled
  }

  /**
   * Snaps the channels the partial shape names to the given values with
   * no animation, notifying listeners synchronously. Channels it leaves
   * out are untouched.
   */
  jumpTo(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, applyJump)
    })
  }

  /**
   * Releases every channel permanently: resolves `settled` and notifies
   * dispose listeners. Calling it again is a no-op.
   *
   * A disposed spring object keeps its final values readable; writes
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

    for (const channel of this.#map.leaves) {
      channel.dispose()
    }
    this.#emitter.clear()
  }

  /**
   * Subscribes to coalesced value changes: at most one `update` per tick,
   * fired after every channel has advanced, plus one per synchronous
   * write. Returns an unsubscribe function.
   */
  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  /**
   * Subscribes to the composite leaving rest: a channel starts moving
   * while all were resting. Always alternates with `stop`. Returns an
   * unsubscribe function.
   */
  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  /**
   * Subscribes to the composite coming to rest: every channel resting,
   * fired after that tick's final `update`. Always alternates with
   * `start`. Returns an unsubscribe function.
   */
  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  /** Subscribes to `dispose`, which fires once. Returns an unsubscribe function. */
  onDispose(callback: () => void) {
    // Channels dispose together, so the first channel's dispose event
    // stands in for the composite's.
    return this.#map.leaves[0]!.onDispose(callback)
  }

  #follow(leader: SpringObject<T>, offset: PartialShape<T> | undefined) {
    this.#motions.flushes.batch(() => {
      this.#map.zip(leader.#map, offset, 'offset', followChannel)
    })
  }
}
