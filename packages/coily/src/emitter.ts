type Handler = () => void

export class Emitter {
  #update: Handler[] = []
  #start: Handler[] = []
  #stop: Handler[] = []

  on(type: 'update' | 'start' | 'stop', handler: Handler) {
    this.#list(type).push(handler)

    return () => {
      this.off(type, handler)
    }
  }

  off(type: 'update' | 'start' | 'stop', handler?: Handler) {
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
  }

  emit(type: 'update' | 'start' | 'stop') {
    const list = this.#list(type)
    if (list.length === 1) {
      list[0]()
    } else if (list.length > 1) {
      for (const handler of list.slice()) {
        handler()
      }
    }
  }

  #list(type: 'update' | 'start' | 'stop') {
    switch (type) {
      case 'update':
        return this.#update
      case 'start':
        return this.#start
      case 'stop':
        return this.#stop
    }
  }
}
