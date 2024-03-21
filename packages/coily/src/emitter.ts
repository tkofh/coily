type EventType = string | symbol

type Handler<T = unknown> = (event: T) => void

type EventHandlerList<T = unknown> = Array<Handler<T>>

type EventHandlerMap<Events extends Record<EventType, unknown>> = Map<
  keyof Events,
  EventHandlerList<Events[keyof Events]>
>

export class Emitter<Events extends Record<EventType, unknown>> {
  #handlers: EventHandlerMap<Events> = new Map()

  on<Key extends keyof Events>(
    type: Key,
    handler: Handler<Events[keyof Events]>,
  ) {
    const handlers: Array<Handler<Events[keyof Events]>> | undefined =
      this.#handlers.get(type)
    if (handlers) {
      handlers.push(handler)
    } else {
      this.#handlers.set(type, [handler] as EventHandlerList<
        Events[keyof Events]
      >)
    }

    return () => {
      this.off(type, handler)
    }
  }

  off<Key extends keyof Events>(
    type: Key,
    handler?: Handler<Events[keyof Events]>,
  ) {
    const handlers: Array<Handler<Events[keyof Events]>> | undefined =
      this.#handlers.get(type)
    if (handlers) {
      if (handler) {
        handlers.splice(handlers.indexOf(handler) >>> 0, 1)
      } else {
        this.#handlers.set(type, [])
      }
    }
  }

  emit<Key extends keyof Events>(type: Key, evt?: Events[Key]) {
    const handlers = this.#handlers?.get(type)
    if (handlers) {
      handlers.slice().map((handler) => {
        handler(evt as Events[Key])
      })
    }
  }
}
