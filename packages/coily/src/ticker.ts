export type TickCallback = (time: number, delta: number, frame: number) => void

export interface TickerOptions {
  fps?: number
  lagThreshold?: number
  adjustedLag?: number
}

const hasWindow = typeof window !== 'undefined'

const request: (callback: FrameRequestCallback) => number = hasWindow
  ? (cb) => window.requestAnimationFrame(cb)
  : (cb) => setTimeout(cb, 1) as unknown as number

const cancel: (id: number) => void = hasWindow
  ? (id) => window.cancelAnimationFrame(id)
  : (id) => clearTimeout(id)

export class Ticker {
  #fps: number
  #gap: number
  #lagThreshold: number
  #adjustedLag: number

  #listeners = new Set<TickCallback>()

  #frame = 0
  #time = 0
  #previousTime = 0
  #delta = 0
  #nextTime: number
  #lastWallTime = 0

  #id = 0
  #stopped = true

  constructor(options?: TickerOptions) {
    this.#fps = options?.fps ?? 60
    this.#gap = 1000 / this.#fps
    this.#lagThreshold = options?.lagThreshold ?? 500
    this.#adjustedLag = options?.adjustedLag ?? 33
    this.#nextTime = this.#gap
  }

  get fps() {
    return this.#fps
  }

  set fps(value: number) {
    this.#fps = value
    this.#gap = 1000 / value
    this.#nextTime = this.#previousTime + this.#gap
  }

  get lagThreshold() {
    return this.#lagThreshold
  }

  set lagThreshold(value: number) {
    this.#lagThreshold = value === 0 ? 1e8 : value
    this.#adjustedLag = Math.min(this.#adjustedLag, this.#lagThreshold)
  }

  get adjustedLag() {
    return this.#adjustedLag
  }

  set adjustedLag(value: number) {
    this.#adjustedLag = Math.min(value, this.#lagThreshold)
  }

  get time() {
    return this.#time
  }

  get frame() {
    return this.#frame
  }

  get delta() {
    return this.#delta
  }

  get deltaRatio() {
    return this.#delta / this.#gap
  }

  start() {
    if (this.#stopped) {
      this.#stopped = false
      this.#lastWallTime = performance.now()
      this.#id = request((t) => this.#tick(t))
    }
  }

  stop() {
    if (!this.#stopped) {
      cancel(this.#id)
      this.#stopped = true
    }
  }

  add(callback: TickCallback) {
    this.#listeners.add(callback)
  }

  remove(callback: TickCallback) {
    this.#listeners.delete(callback)
  }

  once(callback: TickCallback) {
    const wrapper = (time: number, delta: number, frame: number) => {
      callback(time, delta, frame)
      this.#listeners.delete(wrapper)
    }
    this.#listeners.add(wrapper)
  }

  /** Manually advance one frame. */
  tick() {
    this.#advance(this.#gap)
  }

  #tick(timestamp: number) {
    if (this.#stopped) return

    const wallElapsed = timestamp - this.#lastWallTime
    this.#lastWallTime = timestamp

    // If the browser tab was backgrounded or the system lagged,
    // clamp the elapsed time so the simulation doesn't jump.
    const elapsed =
      wallElapsed > this.#lagThreshold ? this.#adjustedLag : wallElapsed

    this.#time += elapsed

    const overlap = this.#time - this.#nextTime
    if (overlap >= 0) {
      this.#frame++
      this.#delta = this.#time - this.#previousTime
      this.#previousTime = this.#time
      this.#nextTime += this.#gap

      this.#dispatch()
    }

    this.#id = request((t) => this.#tick(t))
  }

  #advance(dt: number) {
    this.#time += dt
    this.#frame++
    this.#delta = dt
    this.#previousTime = this.#time

    this.#dispatch()
  }

  #dispatch() {
    for (const listener of this.#listeners) {
      listener(this.#time, this.#delta, this.#frame)
    }
  }
}
