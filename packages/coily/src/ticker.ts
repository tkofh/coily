import type { MotionSet } from './motion-set.ts'
import { invariant } from './util.ts'

export interface TickerOptions {
  /**
   * The target frames per second for the simulation loop
   *
   * must be greater than 0, defaults to 60
   */
  fps?: number | undefined
  /**
   * The maximum elapsed time (in ms) before a frame is considered a lag spike
   * (e.g. from a backgrounded tab). When exceeded, `adjustedLag` is used instead
   * of the real elapsed time. Set to 0 to disable lag detection.
   *
   * must be greater than or equal to 0, defaults to 500
   */
  lagThreshold?: number | undefined
  /**
   * The substitute elapsed time (in ms) used when a lag spike is detected.
   * Clamped to be at most `lagThreshold`.
   *
   * must be greater than or equal to 0, defaults to 33
   */
  adjustedLag?: number | undefined
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

  readonly #motion: MotionSet

  #frame = 0
  #time = 0
  #previousTime = 0
  #delta = 0
  #nextTime: number
  #lastWallTime = 0

  #id = 0
  #stopped = true

  constructor(motions: MotionSet, options?: TickerOptions) {
    this.#motion = motions

    const fps = options?.fps ?? 60
    const lagThreshold = options?.lagThreshold ?? 500
    const adjustedLag = options?.adjustedLag ?? 33

    invariant(fps > 0, 'FPS must be greater than 0')
    invariant(lagThreshold >= 0, 'Lag threshold must be greater than or equal to 0')
    invariant(adjustedLag >= 0, 'Adjusted lag must be greater than or equal to 0')

    this.#fps = fps
    this.#gap = 1000 / fps
    this.#lagThreshold = lagThreshold === 0 ? 1e8 : lagThreshold
    this.#adjustedLag = Math.min(adjustedLag, this.#lagThreshold)
    this.#nextTime = this.#gap
  }

  get fps() {
    return this.#fps
  }

  set fps(value: number) {
    invariant(value > 0, 'FPS must be greater than 0')
    this.#fps = value
    this.#gap = 1000 / value
    this.#nextTime = this.#previousTime + this.#gap
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
      this.#lastWallTime = performance.now()
      this.#id = request((t) => this.#onFrame(t))
    }
  }

  stop() {
    if (!this.#stopped) {
      cancel(this.#id)
      this.#stopped = true
    }
  }

  /** Manually advance one frame. */
  tick() {
    this.#step(this.#gap)
  }

  #onFrame(timestamp: number) {
    if (this.#stopped) return

    const wallElapsed = timestamp - this.#lastWallTime
    this.#lastWallTime = timestamp

    // If the browser tab was backgrounded or the system lagged,
    // clamp the elapsed time so the simulation doesn't jump.
    const elapsed = wallElapsed > this.#lagThreshold ? this.#adjustedLag : wallElapsed

    this.#time += elapsed

    const overlap = this.#time - this.#nextTime
    if (overlap >= 0) {
      this.#frame++
      this.#delta = this.#time - this.#previousTime
      this.#previousTime = this.#time
      this.#nextTime += this.#gap

      this.#motion.tick(this.#delta / 1000)
    }

    this.#id = request((t) => this.#onFrame(t))
  }

  #step(dt: number) {
    this.#time += dt
    this.#frame++
    this.#delta = dt
    this.#previousTime = this.#time

    this.#motion.tick(dt / 1000)
  }
}
