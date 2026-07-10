import { SpringConfig, type SpringOptionKeys, type SpringOptions } from './config.ts'
import { Emitter } from './emitter.ts'
import type { MotionSet } from './motion-set.ts'
import {
  type AnnotationContext,
  ShapeMap,
  type ShapeView,
  describePath,
  isRecord,
  isRecordOrArray,
} from './shape-map.ts'
import { Spring } from './spring.ts'
import { invariant } from './util.ts'

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
  : { [K in keyof T]?: PartialShape<T[K]> | undefined }

/**
 * A deep-readonly view of a value shape. Composite reads (`target`, `value`,
 * `velocity`) return the spring's live mirror objects — refreshed in place
 * on every read — so their channels are typed read-only.
 */
export type ReadonlyShape<T> = T extends number
  ? number
  : { readonly [K in keyof T]: ReadonlyShape<T[K]> }

/**
 * Configuration for a spring object: a single config applied to every
 * channel, or an object mirroring the value shape with configs at any level.
 * A value at a subtree applies to every channel below it; deeper values win.
 * `null` reverts to the default config (or the leader's while following).
 * Plain option objects are accepted anywhere a `SpringConfig` is — except
 * that value shapes own their key namespace: where a channel shares a spring
 * option's name, a bare options object is ambiguous and rejected (pass a
 * `SpringConfig` or a per-channel shape instead), mirroring the runtime rule.
 */
export type ConfigShape<T> =
  | SpringConfig
  | (SpringOptions & { [K in Extract<keyof T, SpringOptionKeys>]?: never })
  | null
  | (T extends number ? never : { [K in keyof T]?: ConfigShape<T[K]> | undefined })

export interface SpringObjectWithOffset<T extends object> {
  spring: SpringObject<T>
  offset?: PartialShape<T> | undefined
}

export type SpringObjectTarget<T extends object> =
  | PartialShape<T>
  | SpringObject<T>
  | SpringObjectWithOffset<T>

// ── Config resolution ───────────────────────────────────────────────

/** Runtime mirror of `SpringOptionKeys` — `satisfies` keeps the two in lockstep. */
const SPRING_OPTION_KEYS: ReadonlySet<string> = new Set(
  Object.keys({
    mass: true,
    tension: true,
    damping: true,
    dampingRatio: true,
    bounce: true,
    duration: true,
    displacement: true,
    precision: true,
  } satisfies Record<SpringOptionKeys, true>),
)

function invalidConfig(path: string): string {
  return `Invalid config for ${describePath(path)}: expected a SpringConfig, spring options, null, or a config shape matching the value`
}

const BRANCH = { branch: true } as const

/**
 * Decides what a config node means at a given position in the shape. A plain
 * object is a config shape when every key belongs to the value shape at this
 * position, and spring options otherwise — value shapes own the namespace, so
 * a shape whose channels are all named like spring options resolves as a
 * config shape and reports its (numeric, hence invalid) leaves instead of
 * silently configuring the wrong thing.
 */
function resolveConfigNode(
  node: unknown,
  context: AnnotationContext,
  path: string,
): { branch: true } | { value: SpringConfig | null } {
  if (node === null) return { value: null }
  if (node instanceof SpringConfig) return { value: node }
  if (Array.isArray(node)) {
    invariant(context.position === 'list', invalidConfig(path))
    return BRANCH
  }
  if (isRecord(node)) {
    if (context.keysMatch) return BRANCH
    const keys = Object.keys(node)
    if (keys.length > 0 && keys.every((key) => SPRING_OPTION_KEYS.has(key))) {
      return { value: new SpringConfig(node as unknown as SpringOptions) }
    }
  }
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

/**
 * A spring over an arbitrary numeric shape: a plain object or array whose
 * leaves are all numbers. The shape is fixed at creation — each numeric leaf
 * becomes an independent scalar spring channel, so per-channel configs,
 * channel-wise following, `settled`, and reduced motion all compose from the
 * scalar machinery. Composite events are coalesced: `update` fires at most
 * once per frame with every channel in its final per-frame state, and `stop`
 * lands after the frame's final `update`.
 *
 * Invariant in `T` (`in out`): following and offsets require exactly
 * matching shapes, so a spring object is never substitutable for one of a
 * wider or narrower shape.
 */
export class SpringObject<in out T extends object> {
  readonly #motions: MotionSet
  readonly #map: ShapeMap<Spring>
  readonly #targetView: ShapeView<Spring>
  readonly #valueView: ShapeView<Spring>
  readonly #velocityView: ShapeView<Spring>

  readonly #emitter = new Emitter()
  /** Composite animation state — `start`/`stop` fire only on its edges. */
  #running = false
  /** Set when a channel emits `update` — cleared by the flush. */
  #dirty = false

  #settled: Promise<void> | null = null
  #resolveSettled: (() => void) | null = null
  #disposed = false

  /**
   * Emits the coalesced composite events. Runs at most once per tick pass
   * (channel events schedule it through the motion set's `FlushQueue`), so
   * every channel is in its final per-frame state: `update` fires once with
   * no torn reads, and `stop` lands after the frame's final `update`.
   */
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

    this.#map = new ShapeMap(value, (leafValue) => new Spring(motions, leafValue))
    if (config !== undefined) {
      // Assigning configs after creation is unobservable here — channels are
      // resting, and configuring a resting spring emits nothing.
      this.#map.applyAnnotation(config, resolveConfigNode, assignConfig, 'config')
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

  /**
   * Retargets the given channels and leaves the rest alone; unknown channels
   * throw. Assigning another spring object (optionally with an offset shape)
   * follows it channel-wise — the shapes must match exactly. While following,
   * a partial numeric target detaches only the channels it names.
   */
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
        this.#map.applyPartial(value, assignTarget)
      })
    }
  }

  get value(): ReadonlyShape<T> {
    this.#valueView.refresh()
    return this.#valueView.root as ReadonlyShape<T>
  }

  set value(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.applyPartial(value, assignValue)
    })
  }

  get velocity(): ReadonlyShape<T> {
    this.#velocityView.refresh()
    return this.#velocityView.root as ReadonlyShape<T>
  }

  set velocity(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.applyPartial(value, assignVelocity)
    })
  }

  /**
   * The config shared by every channel, or `null` when channels currently
   * have different configs.
   */
  get config(): SpringConfig | null {
    const channels = this.#map.leaves
    const first = channels[0]!.config
    for (let i = 1; i < channels.length; i++) {
      if (channels[i]!.config !== first) return null
    }
    return first
  }

  /**
   * Applies a config to the channels it covers and leaves the rest alone:
   * a single config (or `null`) applies to every channel, a config shape
   * only to the channels it mentions.
   */
  set config(value: ConfigShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.applyAnnotation(value ?? null, resolveConfigNode, assignConfig, 'config')
    })
  }

  // ── State ───────────────────────────────────────────────────────

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

  /**
   * Resolves when every channel next comes to rest — immediately if already
   * resting. The same promise is returned for the duration of a motion
   * cycle, and retargeting mid-flight extends the wait: it resolves only
   * at true rest. Disposing the spring resolves a pending promise.
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

  // ── Lifecycle ───────────────────────────────────────────────────

  /** Snaps the given channels to rest at the given values; the rest are left alone. */
  jumpTo(value: PartialShape<T>) {
    this.#motions.flushes.batch(() => {
      this.#map.applyPartial(value, applyJump)
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

  // ── Events ──────────────────────────────────────────────────────

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
    // Channels dispose together and only through this class, so the first
    // channel is a sufficient signal.
    return this.#map.leaves[0]!.onDispose(callback)
  }

  #follow(leader: SpringObject<T>, offset: PartialShape<T> | undefined) {
    this.#motions.flushes.batch(() => {
      this.#map.zip(leader.#map, offset, 'offset', followChannel)
    })
  }
}
