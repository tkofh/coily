import { type LeafParser, ShapeTree, ShapeView, describePath } from './shape-tree.ts'
import { invariant, isRecordOrArray } from './util.ts'

/**
 * The property key that brands a `SpringSource` and holds the api its
 * followers read. It is a registry symbol
 * (`Symbol.for('coily/spring-source')`), so one copy of coily
 * recognizes sources from another when a bundle duplicates the library.
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
 * A live value of type `T` that a spring can animate toward or derive
 * from. Assign a scalar source (`T = number`, the default) to
 * `Spring.target`, and the spring tracks it with its momentum intact.
 *
 * Every `Spring` and `Ramp` is a `SpringSource`, and every
 * `CompositeSpring` is a `SpringSource` of its value shape. `mapSpring`,
 * `velocityOf`, `accelerationOf`, and `targetOf` derive new sources from
 * existing ones. Use the type to name such a value in your own
 * signatures.
 */
export interface SpringSource<T = number> {
  readonly [SpringSourceSymbol]: SpringSourceApi<T>
}

export function isSpringSource(value: unknown): value is SpringSource<unknown> {
  return typeof value === 'object' && value !== null && SpringSourceSymbol in value
}

/**
 * Compile-time validation of a shape of sources: every leaf must be a
 * `SpringSource`, and every branch a plain object or array with at least
 * one leaf. `mapSpring` takes `sources: T & SourceShape<T>`, so an
 * invalid leaf errors on that property, not on the whole argument. The
 * check is structural only, and the runtime validation repeats it for
 * untyped callers. It rejects optional and `undefined`-typed leaves.
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
 * The value shape a shape of sources produces: the same nesting, with
 * every `SpringSource` leaf replaced by its value. A scalar spring leaf
 * becomes `number`, and a composite leaf becomes its read-only value
 * shape. This is what `map` receives when you give `mapSpring` a shape.
 */
export type SourceValues<T> =
  T extends SpringSource<infer V> ? V : { readonly [K in keyof T]: SourceValues<T[K]> }

/** A derived source's flattened recipe: read the base, run the pipeline. */
export interface MappedRecipe {
  /** Deduplicated subscription targets: the chain's true roots. */
  readonly sources: readonly SpringSource<unknown>[]
  /** Reads the value the pipeline starts from. For a shape, that is a live mirror reused across reads. */
  readonly read: () => unknown
  /** The composed maps, applied in order. */
  readonly fns: readonly ((value: unknown) => unknown)[]
}

// Lets `mapSpring` extend a derived source's recipe instead of nesting
// getters, so reads stay iterative and chain depth never nears the call stack.
const RECIPES = new WeakMap<object, MappedRecipe>()

/** The flattened recipe behind `source`, when it is a derived source. */
export function recipeOf(source: object): MappedRecipe | undefined {
  return RECIPES.get(source)
}

/**
 * Registers a derived source's recipe. Every source built on other
 * sources must register at creation. `mapSpring` composition and
 * `resolveLeaderMotions` both reach a derivation's roots through the
 * registry, not through the wrapper object.
 */
export function registerRecipe(source: object, recipe: MappedRecipe): void {
  RECIPES.set(source, recipe)
}

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
 * roots into `roots`. A mapped leaf contributes its recipe's roots and
 * reads through its pipeline.
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
  // The leaves go unused. Followers subscribe to the roots the parser collects.
  const { root } = new ShapeTree(shape, parser)
  return new ShapeView(root, (leaf) => leaf())
}

/**
 * Derives a source from another by a pure function of its value.
 * `mapSpring(leader, (v) => v + 10)` follows 10 above the leader, and
 * `(v) => -v` mirrors it. Like any `SpringSource`, the result can be
 * mapped again, used as a leaf of a shape map, or followed by several
 * springs at once.
 *
 * The result is a stateless view, not a spring. It holds no
 * subscriptions and needs no disposal. `map` runs on every read, and
 * each follower reads on every source update, so `map` must be pure.
 * Nothing re-evaluates it when anything other than `source` changes.
 * Mapping a mapped source extends its pipeline instead of wrapping it,
 * so a chain costs one function call per map.
 */
export function mapSpring(source: SpringSource, map: (value: number) => number): SpringSource
/**
 * Derives a scalar source from several channels by a pure function of
 * their values. `sources` is a single non-scalar source such as a
 * `CompositeSpring`, or a shape: a plain object or array with
 * `SpringSource` leaves, nested to any depth. `map` receives the
 * matching values. For a shape, that is each leaf's current number
 * (`mapSpring({ x, y }, ({ x, y }) => Math.hypot(x, y))`). For a
 * composite, it is the live value shape
 * (`mapSpring(point, ({ x, y }) => Math.hypot(x, y))`). An invalid leaf
 * throws with its path (`position.z`).
 *
 * The result is a stateless view, not a spring. It holds no
 * subscriptions and needs no disposal. `map` runs on every read, and
 * each follower reads on every source update, so `map` must be pure.
 * Every call hands it the same live mirror, refreshed in place, so `map`
 * must not keep what it receives. The mapped source is released with the
 * first of its sources, and followers then detach and keep their current
 * target.
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
      // The same source can sit at several leaves. Subscribe to it once.
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
            // The first source to dispose releases the derived value.
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
