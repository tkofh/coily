import { describePath } from './channel-tree.ts'
import { invariant, isArray, isRecordOrArray } from './util.ts'

/**
 * The key under which a `SpringSource` carries its `SpringSourceApi`.
 * A registry symbol (`Symbol.for('coily/spring-source')`), so sources
 * from one copy of coily are recognized by another when a bundle
 * duplicates the library.
 */
export const SpringSourceSymbol: unique symbol = Symbol.for('coily/spring-source')

/**
 * What a source exposes to its followers, held under `SpringSourceSymbol`
 * on the source object. Followers read `value` on every update and
 * detach on dispose.
 */
export interface SpringSourceApi<T = number> {
  /** The current value, in value units. */
  readonly value: T
  /** Subscribes to value changes. Returns an unsubscribe function. */
  onUpdate(callback: () => void): () => void
  /** Subscribes to the source being released. Returns an unsubscribe function. */
  onDispose(callback: () => void): () => void
}

/**
 * A live value springs can animate toward or derive from. `T` is the
 * value's type: scalar sources (`T = number`, the default) can be
 * assigned to `Spring.target`, which tracks them momentum intact.
 * Every `Spring` is a `SpringSource`, every `CompositeSpring` is a
 * `SpringSource` of its value shape, and `mapSpring` derives new
 * scalar sources from existing sources of any value.
 *
 * The whole contract lives under `SpringSourceSymbol`: the slot holds
 * the `SpringSourceApi` followers read. Keeping it off the object's
 * public face matters when the two disagree — a reactive wrapper's
 * public `value` may track reads into whatever observer is active,
 * while the slot is the plain channel coily reads from inside ticks
 * and event callbacks, where tracking must never happen.
 *
 * The contract is open — any object carrying the slot can bridge a
 * live value (a pointer position, a scroll offset) into a source.
 */
export interface SpringSource<T = number> {
  readonly [SpringSourceSymbol]: SpringSourceApi<T>
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

const joinPath = (path: string, key: string) => (path ? `${path}.${key}` : key)

function emptyShape(path: string): string {
  return `Invalid value at ${describePath(path)}: a shape must contain at least one source`
}

/** A mapped source's flattened recipe: read the base, run the pipeline. */
interface MappedRecipe {
  /** Deduplicated subscription targets — the chain's true roots. */
  readonly sources: readonly SpringSource<unknown>[]
  /** Reads the value the pipeline starts from. */
  readonly read: () => unknown
  /** The composed maps, applied in order. */
  readonly fns: readonly ((value: unknown) => unknown)[]
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
 * collecting the leaves along the way (a mapped leaf contributes its
 * recipe's roots). Structure is fixed at creation, so reads walk
 * precompiled readers instead of re-validating.
 */
function compileNode(node: unknown, path: string, leaves: SpringSource<unknown>[]): () => unknown {
  if (isSpringSource(node)) {
    const recipe = RECIPES.get(node)
    if (recipe) {
      leaves.push(...recipe.sources)
      return () => applyFns(recipe.fns, recipe.read())
    }
    leaves.push(node)
    const api = node[SpringSourceSymbol]
    return () => api.value
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
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads compute `map` of the
 * source's current value on the fly. `map` must be pure — it runs on every read and every
 * source update, and nothing re-evaluates it when anything other than
 * `source` changes. Composition is flat: mapping a mapped source
 * extends its pipeline rather than wrapping it, so chains cost one
 * function call per map however long they grow.
 */
export function mapSpring(source: SpringSource, map: (value: number) => number): SpringSource
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
): SpringSource
export function mapSpring(source: object, map: (value: never) => number): SpringSource {
  const compute = map as (value: unknown) => number

  let recipe: MappedRecipe
  if (isSpringSource(source)) {
    const flat = RECIPES.get(source)
    if (flat) {
      recipe = { sources: flat.sources, read: flat.read, fns: [...flat.fns, compute] }
    } else {
      const api = source[SpringSourceSymbol]
      recipe = { sources: [source], read: () => api.value, fns: [compute] }
    }
  } else {
    const leaves: SpringSource<unknown>[] = []
    const read = compileNode(source, '', leaves)
    recipe = {
      // The same source can sit at several leaves; subscribe to it once.
      sources: [...new Set(leaves)],
      read,
      fns: [compute],
    }
  }

  const { sources, read, fns } = recipe
  const single = sources.length === 1 ? sources[0]![SpringSourceSymbol] : null
  const apis = single ? null : sources.map((leaf) => leaf[SpringSourceSymbol])

  const mapped: SpringSource = Object.freeze({
    [SpringSourceSymbol]: Object.freeze({
      get value() {
        return applyFns(fns, read()) as number
      },
      onUpdate: single
        ? (callback: () => void) => single.onUpdate(callback)
        : (callback: () => void) => {
            const unsubscribes = apis!.map((api) => api.onUpdate(callback))
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
            const unsubscribes = apis!.map((api) =>
              api.onDispose(() => {
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
    }),
  })
  RECIPES.set(mapped, recipe)
  return mapped
}
