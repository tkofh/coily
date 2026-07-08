export class FlushQueue {
  readonly #callbacks = new Set<() => void>()
  /** Nesting depth of active passes — queued callbacks drain when it returns to 0. */
  #depth = 0

  /**
   * Defer `callback` to the end of the current pass, or run it immediately
   * when no pass is active. Queued callbacks are deduplicated, so a composite
   * spring scheduling once per channel still flushes exactly once per pass.
   */
  request(callback: () => void) {
    if (this.#depth > 0) {
      this.#callbacks.add(callback)
    } else {
      callback()
    }
  }

  /**
   * Run `fn` as a pass: requests inside are deferred until it returns.
   * Passes nest — callbacks drain when the outermost one ends.
   */
  batch(fn: () => void) {
    this.enter()
    try {
      fn()
    } finally {
      this.exit()
    }
  }

  /** Begin a pass without a closure — the tick loop's hot path. Pair with `exit`. */
  enter() {
    this.#depth++
  }

  /** End a pass, draining queued callbacks if it was the outermost. */
  exit() {
    this.#depth--
    if (this.#depth === 0) {
      // Callbacks run outside any pass, so mutations they make emit
      // immediately; deleting before invoking permits re-queueing.
      for (const callback of this.#callbacks) {
        this.#callbacks.delete(callback)
        callback()
      }
    }
  }
}
