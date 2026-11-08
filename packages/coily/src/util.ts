export function invariant(
  condition: unknown,
  message?: string | (() => string),
): asserts condition {
  if (condition) {
    return
  }
  const resolved = typeof message === 'function' ? message() : message
  throw new Error(resolved ?? 'Invariant Failed')
}

/**
 * True for plain objects only. Excluding class instances makes shape walks
 * reject a `Spring` instead of descending into it as a nested shape.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function isRecordOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value)
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}

// Shared so resting and disposed springs do not allocate a promise per read.
export const RESOLVED = Promise.resolve()

/** Marks "nothing thrown" for `joinErrors`, since user code can throw any value. */
export const NO_ERROR: unique symbol = Symbol('no error')

// The aggregates `joinErrors` built, so a user's own AggregateError is
// kept whole rather than flattened into ours.
const joined = new WeakSet<AggregateError>()

/**
 * Folds `next` into the error collected so far. Event delivery keeps
 * running after a listener throws, so internal state still settles, then
 * rethrows what it collected: the error itself when one thing threw, an
 * `AggregateError` of all of them when several did. The aggregate's
 * message leads with the first error's, which usually names the cause.
 */
export function joinErrors(collected: unknown, next: unknown): unknown {
  if (collected === NO_ERROR) return next
  const errors =
    collected instanceof AggregateError && joined.has(collected)
      ? [...collected.errors, next]
      : [collected, next]
  const first = errors[0]
  const aggregate = new AggregateError(
    errors,
    `${errors.length} errors while delivering coily events; the first: ${first instanceof Error ? first.message : String(first)}`,
  )
  joined.add(aggregate)
  return aggregate
}
