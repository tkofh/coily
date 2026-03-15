import type { Solver } from './solver.ts'

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

  #solvers = new Set<Solver>()

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

  get stopped() {
    return this.#stopped
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

  add(solver: Solver) {
    this.#solvers.add(solver)
  }

  remove(solver: Solver) {
    this.#solvers.delete(solver)
  }

  has(solver: Solver) {
    return this.#solvers.has(solver)
  }

  /** Advance solvers by `dt` seconds, without affecting internal timing. */
  step(dt: number) {
    for (const solver of this.#solvers) {
      solver.tick(dt)
      if (solver.resting) {
        this.#solvers.delete(solver)
      }
    }
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
    for (const solver of this.#solvers) {
      solver.tick(this.#delta / 1000)
      if (solver.resting) {
        this.#solvers.delete(solver)
      }
    }
  }
}
