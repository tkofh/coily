import { NO_ERROR, joinErrors } from './util.ts'

type Handler = () => void

type EventType = 'update' | 'start' | 'stop' | 'dispose'

/** Minimal fixed-event emitter behind motions and composite springs. */
export class Emitter {
  #update: Handler[] = []
  #start: Handler[] = []
  #stop: Handler[] = []
  #dispose: Handler[] = []

  on(type: EventType, handler: Handler) {
    this.#list(type).push(handler)

    return () => {
      this.off(type, handler)
    }
  }

  off(type: EventType, handler?: Handler) {
    const list = this.#list(type)
    if (handler) {
      // `>>> 0` turns an indexOf miss into 2^32 - 1, so splice removes
      // nothing for a handler that was never subscribed.
      list.splice(list.indexOf(handler) >>> 0, 1)
    } else {
      list.length = 0
    }
  }

  clear() {
    this.#update.length = 0
    this.#start.length = 0
    this.#stop.length = 0
    this.#dispose.length = 0
  }

  /**
   * Calls every handler for `type`. One that throws doesn't stop the rest,
   * because internal subscribers (a `settled` promise, a composite's
   * channel hooks) share the list with user code. The errors rethrow after
   * the last handler, per `joinErrors`.
   */
  emit(type: EventType) {
    const list = this.#list(type)
    // A snapshot keeps mid-emit (un)subscribes from shifting the iteration.
    // The common single-handler path skips that per-tick allocation.
    if (list.length === 1) {
      list[0]!()
    } else if (list.length > 1) {
      let error: unknown = NO_ERROR
      for (const handler of list.slice()) {
        try {
          handler()
        } catch (caught) {
          error = joinErrors(error, caught)
        }
      }
      if (error !== NO_ERROR) throw error
    }
  }

  #list(type: EventType) {
    switch (type) {
      case 'update':
        return this.#update
      case 'start':
        return this.#start
      case 'stop':
        return this.#stop
      case 'dispose':
        return this.#dispose
    }
  }
}
