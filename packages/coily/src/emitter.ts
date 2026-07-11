type Handler = () => void

type EventType = 'update' | 'start' | 'stop' | 'dispose'

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

  emit(type: EventType) {
    const list = this.#list(type)
    if (list.length === 1) {
      list[0]!()
    } else if (list.length > 1) {
      for (const handler of list.slice()) {
        handler()
      }
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
