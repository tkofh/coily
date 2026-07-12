import type { SpringConfig } from './config.ts'

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
  readonly config: SpringConfig | null
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
 * Derives a source from another by a pure function of its value:
 * `mapSpring(leader, (v) => v + 10)` follows 10 above the leader,
 * `(v) => -v` mirrors it. Maps compose — a mapped source is a
 * `SpringSource` like any other, so it can be mapped again or followed
 * by several springs at once.
 *
 * The result is a stateless view, not a spring: it holds no
 * subscriptions and needs no disposal, and reads compute `map(source.value)`
 * on the fly. `map` must be pure — it runs on every read and every
 * source update, and nothing re-evaluates it when anything other than
 * `source` changes.
 */
export function mapSpring(source: SpringSource, map: (value: number) => number): SpringSource {
  return Object.freeze({
    [SpringSourceSymbol]: true as const,
    get value() {
      return map(source.value)
    },
    get config() {
      return source.config
    },
    onUpdate: (callback: () => void) => source.onUpdate(callback),
    onConfigure: (callback: () => void) => source.onConfigure(callback),
    onDispose: (callback: () => void) => source.onDispose(callback),
  })
}
