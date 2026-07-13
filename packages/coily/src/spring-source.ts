import { type LeafParser, ShapeTree, ShapeView, describePath } from './shape-tree.ts'
import { invariant, isRecordOrArray } from './util.ts'

/**
 * The property key that brands a `SpringSource` and holds the channel its
 * followers read. A registry symbol (`Symbol.for('coily/spring-source')`),
 * so sources from one copy of coily are recognized by another when a
 * bundle duplicates the library.
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
 * A live value a spring can animate toward or derive from. `T` is the
 * value's type: a scalar source (`T = number`, the default) can be
 * assigned to `Spring.target`, which then tracks it momentum intact.
 *
 * Every `Spring` is a `SpringSource`, every `CompositeSpring` is a
 * `SpringSource` of its value shape, and `mapSpring`, `velocityOf`, and
 * `accelerationOf` derive fresh sources from existing ones. You take
 * sources from those APIs and pass them wherever one is accepted; the
 * type names such a value in your own signatures.
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

/** A mapped source's flattened recipe: read the base, run the pipeline. */
interface MappedRecipe {
  /** Deduplicated subscription targets — the chain's true roots. */
  readonly sources: readonly SpringSource<unknown>[]
  /** Reads the value the pipeline starts from — for a shape, a live mirror reused across reads. */
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

function sourceMismatch(path: string): string {
  return `Invalid value at ${describePath(path)}: expected a SpringSource or a nested shape of SpringSources`
}

/**
 * Parses a shape of sources into a live view, collecting subscription
 * roots along the way (a mapped leaf contributes its recipe's roots and
 * reads through its pipeline). Structure is validated once at creation;
 * reads refresh a stable mirror through the view's slots, so per-update
 * reads do no traversal or allocation.
 */
function compileShape(
  shape: Record<string, unknown> | unknown[],
  roots: SpringSource<unknown>[],
): ShapeView<() => unknown> {
  const parser: LeafParser<() => unknown> = {
    match(value) {
      if (!isSpringSource(value)) return undefined
      const recipe = RECIPES.get(value)
      if (recipe) {
        roots.push(...recipe.sources)
        return () => applyFns(recipe.fns, recipe.read())
      }
      roots.push(value)
      const api = value[SpringSourceSymbol]
      return () => api.value
    },
    mismatch: sourceMismatch,
    empty: (path) =>
      `Invalid value at ${describePath(path)}: a shape must contain at least one source`,
  }
  // Leaves are discarded — the roots collected through the parser closure
  // are what followers subscribe to, not the per-leaf read functions.
  const { root } = new ShapeTree(shape, parser)
  return new ShapeView(root, (leaf) => leaf())
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
 * source's current value on the fly. `map` must be pure — it runs on
 * every read and every source update, and nothing re-evaluates it when
 * anything other than `source` changes. Composition is flat: mapping a
 * mapped source extends its pipeline rather than wrapping it, so chains
 * cost one function call per map however long they grow.
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
 * every call hands it the same live mirror of the values, refreshed in
 * place. The mapped source is released with the first of its sources:
 * followers detach then, keeping their current target, as they would
 * from a disposed spring.
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
    invariant(isRecordOrArray(source), () => sourceMismatch(''))
    const roots: SpringSource<unknown>[] = []
    const view = compileShape(source, roots)
    recipe = {
      // The same source can sit at several leaves; subscribe to it once.
      sources: [...new Set(roots)],
      read: () => {
        view.refresh()
        return view.root
      },
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
