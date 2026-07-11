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

  exit() {
    this.#depth--
    if (this.#depth === 0) {
      for (const callback of this.#callbacks) {
        this.#callbacks.delete(callback)
        callback()
      }
    }
  }
}
