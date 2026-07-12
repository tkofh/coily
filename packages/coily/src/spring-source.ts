import { describePath } from './channel-tree.ts'
import type { SpringDefinition } from './config.ts'
import { invariant, isArray, isRecordOrArray } from './util.ts'

/**
 * Brands a value as a `SpringSource`. A registry symbol
 * (`Symbol.for('coily/spring-source')`), so sources from one copy of
 * coily are recognized by another when a bundle duplicates the library.
 */
export const SpringSourceSymbol: unique symbol = Symbol.for('coily/spring-source')

/**
 * A live numeric value a spring can animate toward: assign one to
 * `Spring.target` and the spring tracks it, momentum intact. Every
 * `Spring` is a `SpringSource`; `mapSpring` derives new sources from
 * existing ones.
 *
 * The contract is open — an object with these members can bridge any
 * live value (a pointer position, a scroll offset) into a followable
 * source. Followers read `value` on every update, adopt `config` when
 * they have none of their own (`null` means the default), and detach
 * on dispose.
 */
export interface SpringSource {
  readonly [SpringSourceSymbol]: true
  /** The current value, in value units. */
  readonly value: number
  /** The config followers without their own adopt. `null` means the default. */
  readonly config: SpringDefinition | null
  /** Subscribes to value changes. Returns an unsubscribe function. */
  onUpdate(callback: () => void): () => void
  /** Subscribes to `config` changes. Returns an unsubscribe function. */
  onConfigure(callback: () => void): () => void
  /** Subscribes to the source being released. Returns an unsubscribe function. */
  onDispose(callback: () => void): () => void
}

export function isSpringSource(value: unknown): value is SpringSource {
  return typeof value === 'object' && value !== null && SpringSourceSymbol in value
}

/**
 * Compile-time validation of a shape of sources: every leaf must be a
 * `SpringSource`, every branch a plain object or array with at least one
 * leaf. Used as `sources: T & SourceShape<T>` so an invalid leaf errors
 * on that property rather than on the whole argument. Purely structural,
 * and mirrored by the runtime validation for untyped callers. Optional
 * and `undefined`-typed leaves are rejected.
 */
export type SourceShape<T> = 0 extends 1 & T
  ? T // any defers wholly to the runtime checks
  : T extends SpringSource
    ? SpringSource
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
                    : SourceShape<T[K]>
              }
          : never

/**
 * The numeric shape a shape of sources produces: the same nesting with
 * every `SpringSource` leaf replaced by its `number` value. What `map`
 * receives when `mapSpring` is given a shape.
 */
export type SourceValues<T> = T extends SpringSource
  ? number
  : { readonly [K in keyof T]: SourceValues<T[K]> }

const noop = () => {}
// A pinned config never changes, so configure subscriptions never fire.
const neverConfigure = () => noop

const joinPath = (path: string, key: string) => (path ? `${path}.${key}` : key)

function emptyShape(path: string): string {
  return `Invalid value at ${describePath(path)}: a shape must contain at least one source`
}

/**
 * Validates one node of a source shape and compiles its reader,
 * collecting the leaves along the way. Structure is fixed at creation,
 * so reads walk precompiled readers instead of re-validating.
 */
function compileNode(node: unknown, path: string, leaves: SpringSource[]): () => unknown {
  if (isSpringSource(node)) {
    leaves.push(node)
    return () => node.value
  }

  invariant(
    isRecordOrArray(node),
    () =>
      `Invalid value at ${describePath(path)}: expected a SpringSource or a nested shape of SpringSources`,
  )

  if (isArray(node)) {
    invariant(node.length > 0, () => emptyShape(path))
    const readers: (() => unknown)[] = []
    for (let index = 0; index < node.length; index++) {
      readers.push(compileNode(node[index], joinPath(path, String(index)), leaves))
    }
    return () => readers.map((read) => read())
  }

  const keys = Object.keys(node)
  invariant(keys.length > 0, () => emptyShape(path))
  const readers: [string, () => unknown][] = []
  for (const key of keys) {
    readers.push([key, compileNode(node[key], joinPath(path, key), leaves)])
  }
  return () => {
    const values: Record<string, unknown> = {}
    for (const [key, read] of readers) {
      values[key] = read()
    }
    return values
  }
}

/**
 * Derives a source from another by a pure function of its value:
 * `mapSpring(leader, (v) => v + 10)` follows 10 above the leader,
 * `(v) => -v` mirrors it. Maps compose — a mapped source is a
 * `SpringSource` like any other, so it can be mapped again, used as a
 * leaf of a shape map, or followed by several springs at once.
 *
 * `config` sets the config the mapped source offers followers: a
 * `SpringDefinition` to offer that one, `null` to offer none (followers
 * fall back to their default). Omitted, the underlying source's config
 * passes through, changes included; given, it is fixed, and the mapped
 * source never fires configure events.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads compute `map(source.value)`
 * on the fly. `map` must be pure — it runs on every read and every
 * source update, and nothing re-evaluates it when anything other than
 * `source` changes.
 */
export function mapSpring(
  source: SpringSource,
  map: (value: number) => number,
  config?: SpringDefinition | null,
): SpringSource
/**
 * Derives a source from several others by a pure function of their
 * values. `sources` is a shape — a plain object or array with
 * `SpringSource` leaves, nested arbitrarily — and `map` receives the
 * same shape with each leaf's current number:
 * `mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y), null)` derives
 * the springs' distance from the origin. Invalid leaves throw with
 * their path (`position.z`).
 *
 * Several sources leave no single config to pass through, so `config`
 * is required: the config the mapped source offers followers, or `null`
 * to offer none (followers fall back to their default). Either way it
 * is fixed — the mapped source never fires configure events.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads compute `map` over the
 * sources' values on the fly. `map` must be pure — it runs on every
 * read and every leaf update, and nothing re-evaluates it when anything
 * other than the sources changes. The mapped source is released with
 * the first of its sources: followers detach then, keeping their
 * current target, as they would from a disposed spring.
 */
export function mapSpring<T extends object>(
  sources: T & SourceShape<T>,
  map: (values: SourceValues<T>) => number,
  config: SpringDefinition | null,
): SpringSource
export function mapSpring(
  source: object,
  map: (value: never) => number,
  config?: SpringDefinition | null,
): SpringSource {
  const compute = map as (value: unknown) => number
  const offered = config ?? null

  if (isSpringSource(source)) {
    const pinned = config !== undefined
    return Object.freeze({
      [SpringSourceSymbol]: true as const,
      get value() {
        return compute(source.value)
      },
      get config() {
        return pinned ? offered : source.config
      },
      onUpdate: (callback: () => void) => source.onUpdate(callback),
      onConfigure: pinned ? neverConfigure : (callback: () => void) => source.onConfigure(callback),
      onDispose: (callback: () => void) => source.onDispose(callback),
    })
  }

  const leaves: SpringSource[] = []
  const readValues = compileNode(source, '', leaves)
  // The same source can sit at several leaves; subscribe to it once.
  const sources = [...new Set(leaves)]

  return Object.freeze({
    [SpringSourceSymbol]: true as const,
    get value() {
      return compute(readValues())
    },
    get config() {
      return offered
    },
    onUpdate: (callback: () => void) => {
      const unsubscribes = sources.map((leaf) => leaf.onUpdate(callback))
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    onConfigure: neverConfigure,
    onDispose: (callback: () => void) => {
      // The first source to dispose releases the derived value: fire
      // once, then drop every subscription.
      let fired = false
      const unsubscribes = sources.map((leaf) =>
        leaf.onDispose(() => {
          if (fired) return
          fired = true
          for (const unsubscribe of unsubscribes) unsubscribe()
          callback()
        }),
      )
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
  })
}
