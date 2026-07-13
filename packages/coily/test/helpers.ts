import type { createSpringSystem } from '../src/index.ts'
import { type SpringSource, SpringSourceSymbol } from '../src/spring-source.ts'

/** One 60fps frame in milliseconds — the step most specs advance by. */
export const FRAME = 1000 / 60

/** Advances the system a frame at a time until `spring` rests or `maxFrames` elapse. */
export function advanceUntilResting(
  system: ReturnType<typeof createSpringSystem>,
  spring: { isResting: boolean },
  maxFrames = 600,
): void {
  for (let i = 0; i < maxFrames; i++) {
    system.advance(FRAME)
    if (spring.isResting) return
  }
}

/** Resolves after a macrotask, letting queued promise callbacks (`settled`) run. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve))
}

/** A hand-rolled `SpringSource` a test drives by hand: the bare contract, nothing more. */
export interface ManualSource {
  readonly source: SpringSource
  /** Sets the value and notifies subscribers, as a real source would on update. */
  set(value: number): void
  /** How many times the source has been subscribed to — for the subscribe-once checks. */
  readonly subscriptions: number
}

/**
 * Builds a `SpringSource` backed by a plain mutable number, standing in for
 * any object honoring the contract (a pointer position, a scroll offset).
 */
export function makeSource(initial: number): ManualSource {
  const listeners = new Set<() => void>()
  let current = initial
  let subscriptions = 0

  const source: SpringSource = {
    [SpringSourceSymbol]: {
      get value() {
        return current
      },
      onUpdate: (callback) => {
        subscriptions++
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      onDispose: () => () => {},
    },
  }

  return {
    source,
    set(value) {
      current = value
      for (const callback of listeners) callback()
    },
    get subscriptions() {
      return subscriptions
    },
  }
}
