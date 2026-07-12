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
 * A live value springs can animate toward or derive from. `T` is the
 * value's type: scalar sources (`T = number`, the default) can be
 * assigned to `Spring.target`, which tracks them momentum intact.
 * Every `Spring` is a `SpringSource`, every `CompositeSpring` is a
 * `SpringSource` of its value shape, and `mapSpring` derives new
 * scalar sources from existing sources of any value.
 *
 * The contract is open — an object with these members can bridge any
 * live value (a pointer position, a scroll offset) into a source.
 * Followers read `value` on every update, adopt `config` when they
 * have none of their own (`null` means the default), and detach on
 * dispose.
 */
export interface SpringSource<T = number> {
  readonly [SpringSourceSymbol]: true
  /** The current value, in value units. */
  readonly value: T
  /** The config followers without their own adopt. `null` means the default. */
  readonly config: SpringDefinition | null
  /** Subscribes to value changes. Returns an unsubscribe function. */
  onUpdate(callback: () => void): () => void
  /** Subscribes to `config` changes. Returns an unsubscribe function. */
  onConfigure(callback: () => void): () => void
  /** Subscribes to the source being released. Returns an unsubscribe function. */
  onDispose(callback: () => void): () => void
}

export function isSpringSource(value: unknown): value is SpringSource<unknown> {
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
  : T extends SpringSource<unknown>
    ? SpringSource<unknown>
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
 * The value shape a shape of sources produces: the same nesting with
 * every `SpringSource` leaf replaced by its value — `number` for a
 * scalar spring, the read-only value shape for a composite. What `map`
 * receives when `mapSpring` is given a shape.
 */
export type SourceValues<T> =
  T extends SpringSource<infer V> ? V : { readonly [K in keyof T]: SourceValues<T[K]> }

const noop = () => {}
// A pinned config never changes, so configure subscriptions never fire.
const neverConfigure = () => noop

const joinPath = (path: string, key: string) => (path ? `${path}.${key}` : key)

function emptyShape(path: string): string {
  return `Invalid value at ${describePath(path)}: a shape must contain at least one source`
}

/** A mapped source's flattened recipe: read the base, run the pipeline. */
interface MappedRecipe {
  /** Deduplicated subscription targets — the chain's true roots. */
  readonly sources: readonly SpringSource<unknown>[]
  /**
   * Deduplicated config providers — the shape's immediate leaves, not
   * the roots, so a mapped leaf participates with the config it offers
   * (its pin included) rather than its sources' own.
   */
  readonly configSources: readonly SpringSource<unknown>[]
  /** Reads the value the pipeline starts from. */
  readonly read: () => unknown
  /** The composed maps, applied in order. */
  readonly fns: readonly ((value: unknown) => unknown)[]
  /**
   * The statically offered config. `null` means the config was never
   * given anywhere in the chain: the config the `configSources` agree
   * on passes through, live.
   */
  readonly pinned: { readonly value: SpringDefinition | null } | null
}

// Mapped sources flatten when composed: the registry lets `mapSpring`
// recognize its own results and extend their recipe instead of nesting
// getters, so reads stay iterative and chain depth never approaches the
// call stack.
const RECIPES = new WeakMap<object, MappedRecipe>()

function applyFns(fns: readonly ((value: unknown) => unknown)[], value: unknown): unknown {
  let result = value
  for (const fn of fns) {
    result = fn(result)
  }
  return result
}

/**
 * Validates one node of a source shape and compiles its reader,
 * collecting the leaves along the way: subscription roots into `leaves`
 * (a mapped leaf contributes its recipe's roots) and config providers
 * into `configLeaves` (a mapped leaf contributes itself). Structure is
 * fixed at creation, so reads walk precompiled readers instead of
 * re-validating.
 */
function compileNode(
  node: unknown,
  path: string,
  leaves: SpringSource<unknown>[],
  configLeaves: SpringSource<unknown>[],
): () => unknown {
  if (isSpringSource(node)) {
    configLeaves.push(node)
    const recipe = RECIPES.get(node)
    if (recipe) {
      leaves.push(...recipe.sources)
      return () => applyFns(recipe.fns, recipe.read())
    }
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
      readers.push(compileNode(node[index], joinPath(path, String(index)), leaves, configLeaves))
    }
    return () => readers.map((read) => read())
  }

  const keys = Object.keys(node)
  invariant(keys.length > 0, () => emptyShape(path))
  const readers: [string, () => unknown][] = []
  for (const key of keys) {
    readers.push([key, compileNode(node[key], joinPath(path, key), leaves, configLeaves)])
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
 * `source` changes. Composition is flat: mapping a mapped source
 * extends its pipeline rather than wrapping it, so chains cost one
 * function call per map however long they grow.
 */
export function mapSpring(
  source: SpringSource,
  map: (value: number) => number,
  config?: SpringDefinition | null,
): SpringSource
/**
 * Derives a scalar source from several channels by a pure function of
 * their values. `sources` is a shape — a plain object or array with
 * `SpringSource` leaves, nested arbitrarily — or a single non-scalar
 * source such as a `CompositeSpring`. `map` receives the matching
 * values: each leaf's current number for a shape
 * (`mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y))`), the
 * live value shape for a composite
 * (`mapSpring(point, ({ x, y }) => Math.hypot(x, y))`). Invalid
 * leaves throw with their path (`position.z`).
 *
 * `config` sets the config the mapped source offers followers: a
 * `SpringDefinition` to offer that one, `null` to offer none (followers
 * fall back to their default). Given, it is fixed, and the mapped
 * source never fires configure events. Omitted, the sources' shared
 * config passes through, changes included: the config the leaves offer
 * when every leaf offers the same `SpringDefinition`, none while any
 * differ. A composite leaf offers its channels' shared config; a
 * mapped leaf, whatever it offers its own followers.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads compute `map` over the
 * sources' values on the fly. `map` must be pure — it runs on every
 * read and every source update — and must not retain what it receives:
 * a composite hands it the same live mirror its `value` returns. The
 * mapped source is released with the first of its sources: followers
 * detach then, keeping their current target, as they would from a
 * disposed spring.
 */
export function mapSpring<const T extends object>(
  sources: T & SourceShape<T>,
  map: (values: SourceValues<T>) => number,
  config?: SpringDefinition | null,
): SpringSource
export function mapSpring(
  source: object,
  map: (value: never) => number,
  config?: SpringDefinition | null,
): SpringSource {
  const compute = map as (value: unknown) => number

  let recipe: MappedRecipe
  if (isSpringSource(source)) {
    const flat = RECIPES.get(source)
    const pinned = config !== undefined ? { value: config } : (flat?.pinned ?? null)
    recipe = flat
      ? {
          sources: flat.sources,
          configSources: flat.configSources,
          read: flat.read,
          fns: [...flat.fns, compute],
          pinned,
        }
      : {
          sources: [source],
          configSources: [source],
          read: () => source.value,
          fns: [compute],
          pinned,
        }
  } else {
    const leaves: SpringSource<unknown>[] = []
    const configLeaves: SpringSource<unknown>[] = []
    const read = compileNode(source, '', leaves, configLeaves)
    recipe = {
      // The same source can sit at several leaves; subscribe to it once.
      sources: [...new Set(leaves)],
      configSources: [...new Set(configLeaves)],
      read,
      fns: [compute],
      pinned: config !== undefined ? { value: config } : null,
    }
  }

  const { sources, configSources, read, fns, pinned } = recipe
  const single = sources.length === 1 ? sources[0]! : null
  const singleConfig = configSources.length === 1 ? configSources[0]! : null

  const mapped: SpringSource = Object.freeze({
    [SpringSourceSymbol]: true as const,
    get value() {
      return applyFns(fns, read()) as number
    },
    get config() {
      if (pinned) return pinned.value
      // Mirrors `CompositeSpring.config`: the config every provider
      // offers when they agree, none while any differ.
      const first = configSources[0]!.config
      for (let i = 1; i < configSources.length; i++) {
        if (configSources[i]!.config !== first) return null
      }
      return first
    },
    onUpdate: single
      ? (callback: () => void) => single.onUpdate(callback)
      : (callback: () => void) => {
          const unsubscribes = sources.map((leaf) => leaf.onUpdate(callback))
          return () => {
            for (const unsubscribe of unsubscribes) unsubscribe()
          }
        },
    onConfigure: pinned
      ? neverConfigure
      : singleConfig
        ? (callback: () => void) => singleConfig.onConfigure(callback)
        : (callback: () => void) => {
            // A provider's configure may leave the agreement where it was;
            // followers re-read `config` and no-op when it resolves the same.
            const unsubscribes = configSources.map((leaf) => leaf.onConfigure(callback))
            return () => {
              for (const unsubscribe of unsubscribes) unsubscribe()
            }
          },
    onDispose: single
      ? (callback: () => void) => single.onDispose(callback)
      : (callback: () => void) => {
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
  RECIPES.set(mapped, recipe)
  return mapped
}
