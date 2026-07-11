import type { MotionSet } from './motion-set.ts'
import { invariant } from './util.ts'

export interface TickerOptions {
  readonly fps?: number | undefined
  readonly lagThreshold?: number | undefined
  readonly adjustedLag?: number | undefined
}

const request = (callback: FrameRequestCallback): number =>
  typeof window !== 'undefined'
    ? window.requestAnimationFrame(callback)
    : (setTimeout(() => callback(performance.now()), 16) as unknown as number)

const cancel = (id: number): void => {
  if (typeof window !== 'undefined') {
    window.cancelAnimationFrame(id)
  } else {
    clearTimeout(id)
  }
}

export class Ticker {
  #fps: number
  #gap: number
  #capGap: number
  #lagThreshold: number
  #adjustedLag: number

  readonly #motion: MotionSet

  #frame = 0
  #time = 0
  #delta = 0
  #acc = 0
  #lastWallTime = 0
  #primed = false

  #id = 0
  #stopped = true
  #sleeping = false

  constructor(motions: MotionSet, options?: TickerOptions) {
    this.#motion = motions

    const fps = options?.fps ?? 0
    const lagThreshold = options?.lagThreshold ?? 500
    const adjustedLag = options?.adjustedLag ?? 33

    invariant(fps >= 0, 'FPS must be greater than or equal to 0')
    invariant(lagThreshold >= 0, 'Lag threshold must be greater than or equal to 0')
    invariant(adjustedLag >= 0, 'Adjusted lag must be greater than or equal to 0')

    this.#fps = fps
    this.#gap = fps === 0 ? 1000 / 60 : 1000 / fps
    this.#capGap = fps === 0 ? 0 : 1000 / fps
    this.#lagThreshold = lagThreshold === 0 ? 1e8 : lagThreshold
    this.#adjustedLag = Math.min(adjustedLag, this.#lagThreshold)

    motions.onWake = () => this.#wake()
  }

  get fps() {
    return this.#fps
  }

  set fps(value: number) {
    invariant(value >= 0, 'FPS must be greater than or equal to 0')
    this.#fps = value
    this.#gap = value === 0 ? 1000 / 60 : 1000 / value
    this.#capGap = value === 0 ? 0 : 1000 / value
  }

  get lagThreshold() {
    return this.#lagThreshold
  }

  set lagThreshold(value: number) {
    invariant(value >= 0, 'Lag threshold must be greater than or equal to 0')
    this.#lagThreshold = value === 0 ? 1e8 : value
    this.#adjustedLag = Math.min(this.#adjustedLag, this.#lagThreshold)
  }

  get adjustedLag() {
    return this.#adjustedLag
  }

  set adjustedLag(value: number) {
    invariant(value >= 0, 'Adjusted lag must be greater than or equal to 0')
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
      this.#primed = false
      this.#acc = 0
      this.#schedule()
    }
  }

  stop() {
    if (!this.#stopped) {
      if (!this.#sleeping) {
        cancel(this.#id)
      }
      this.#stopped = true
      this.#sleeping = false
    }
  }

  tick() {
    this.#step(this.#gap)
  }

  #schedule() {
    if (this.#motion.size === 0) {
      this.#sleeping = true
      this.#acc = 0
    } else {
      this.#sleeping = false
      this.#id = request((t) => this.#onFrame(t))
    }
  }

  #wake() {
    if (!this.#stopped && this.#sleeping) {
      this.#primed = false
      this.#schedule()
    }
  }

  #onFrame(timestamp: number) {
    if (this.#stopped) return

    if (this.#primed) {
      const wallElapsed = timestamp - this.#lastWallTime
      const elapsed = wallElapsed > this.#lagThreshold ? this.#adjustedLag : wallElapsed

      this.#acc += elapsed

      if (this.#acc + elapsed / 2 >= this.#capGap) {
        const delta = this.#acc
        this.#acc = 0
        this.#step(delta)
      }
    } else {
      this.#primed = true
    }
    this.#lastWallTime = timestamp

    this.#schedule()
  }

  #step(dt: number) {
    this.#time += dt
    this.#frame++
    this.#delta = dt

    this.#motion.tick(dt / 1000)
  }
}
