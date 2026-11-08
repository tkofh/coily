import { NO_ERROR, joinErrors } from './util.ts'

/**
 * Defers callbacks while inside a batch or tick. At depth 0, `request`
 * runs the callback immediately. Otherwise it queues the callback, once
 * per callback, until the outermost exit. Composite springs use it to
 * merge per-channel events into composite ones.
 */
export class FlushQueue {
  readonly #callbacks = new Set<() => void>()
  #depth = 0

  request(callback: () => void) {
    if (this.#depth > 0) {
      this.#callbacks.add(callback)
    } else {
      callback()
    }
  }

  batch(fn: () => void) {
    this.enter()
    try {
      fn()
    } finally {
      this.exit()
    }
  }

  enter() {
    this.#depth++
  }

  /**
   * Leaves a batch. The outermost exit runs every queued callback, even
   * after one throws, then rethrows per `joinErrors`.
   */
  exit() {
    this.#depth--
    if (this.#depth === 0) {
      let error: unknown = NO_ERROR
      for (const callback of this.#callbacks) {
        this.#callbacks.delete(callback)
        try {
          callback()
        } catch (caught) {
          error = joinErrors(error, caught)
        }
      }
      if (error !== NO_ERROR) throw error
    }
  }
}
