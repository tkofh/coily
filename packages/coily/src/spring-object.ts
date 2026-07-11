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
 * A config at a subtree applies to every channel below it; deeper configs win.
 * `null` reverts to the default config (or the leader's while following).
 * Configs are always `SpringConfig` instances (from `defineSpring`), so a
 * plain object is unambiguously a config shape and any non-config leaf it
 * reaches is an error.
 */
export type ConfigShape<T> =
  | SpringConfig
  | null
  | (T extends number ? never : { readonly [K in keyof T]?: ConfigShape<T[K]> | undefined })

export interface SpringObjectWithOffset<T extends object> {
  readonly spring: SpringObject<T>
  readonly offset?: PartialShape<T> | undefined
}

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

const RESOLVED = Promise.resolve()

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

  get value(): ReadonlyShape<T> {
    this.#valueView.refresh()
    return this.#valueView.root as ReadonlyShape<T>
  }

  set value(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, assignValue)
    })
  }

  get velocity(): ReadonlyShape<T> {
    this.#velocityView.refresh()
    return this.#velocityView.root as ReadonlyShape<T>
  }

  set velocity(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, assignVelocity)
    })
  }

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

  get timeRemaining(): number {
    let max = 0
    for (const channel of this.#map.leaves) {
      const remaining = channel.timeRemaining
      if (remaining > max) max = remaining
    }
    return max
  }

  get isResting(): boolean {
    for (const channel of this.#map.leaves) {
      if (!channel.isResting) return false
    }
    return true
  }

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

  jumpTo(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.scatter(value, applyJump)
    })
  }

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

  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  onStart(callback: () => void) {
    return this.#emitter.on('start', callback)
  }

  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  onDispose(callback: () => void) {
    return this.#map.leaves[0]!.onDispose(callback)
  }

  #follow(leader: SpringObject<T>, offset: PartialShape<T> | undefined) {
    this.#motions.flushes.batch(() => {
      this.#map.zip(leader.#map, offset, 'offset', followChannel)
    })
  }
}
