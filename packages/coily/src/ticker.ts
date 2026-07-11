import type { MotionSet } from './motion-set.ts'
import { invariant } from './util.ts'

export interface TickerOptions {
  /**
   * Frame-rate ceiling for the simulation loop, or 0 for no ceiling. When
   * set, ticks are paced to whole display frames — the loop can never tick
   * more often than the display refreshes — and each tick's `delta` is the
   * true elapsed time across the frames it spans. When 0, springs advance
   * once per displayed frame, so physics resolution matches the display's
   * refresh rate on 60, 120, 144, and adaptive-sync panels alike.
   *
   * must be greater than or equal to 0, defaults to 0 (no ceiling)
   */
  readonly fps?: number | undefined
  /**
   * The maximum elapsed time (in ms) before a frame is considered a lag spike
   * (e.g. from a backgrounded tab). When exceeded, `adjustedLag` is used instead
   * of the real elapsed time. Set to 0 to disable lag detection.
   *
   * must be greater than or equal to 0, defaults to 500
   */
  readonly lagThreshold?: number | undefined
  /**
   * The substitute elapsed time (in ms) used when a lag spike is detected.
   * Clamped to be at most `lagThreshold`.
   *
   * must be greater than or equal to 0, defaults to 33
   */
  readonly adjustedLag?: number | undefined
}

// Resolved per call so tests can stub `window.requestAnimationFrame`. The
// non-browser fallback forwards a timestamp because `setTimeout` provides
// none — the frame callback derives every delta from its timestamp argument.
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
  /** The frame-rate ceiling, 0 meaning uncapped — mirroring `lagThreshold`'s 0 = disabled. */
  #fps: number
  /** Reference duration: the manual `tick()` step and the `deltaRatio` denominator. */
  #gap: number
  /** Pacing threshold — `1000 / fps` when capped, 0 (tick every frame) when not. */
  #capGap: number
  #lagThreshold: number
  #adjustedLag: number

  readonly #motion: MotionSet

  #frame = 0
  #time = 0
  #delta = 0
  /** Frame time accumulated toward the next tick while a cap is pacing. */
  #acc = 0
  #lastWallTime = 0
  /** False until the first callback after (re)scheduling anchors the clock. */
  #primed = false

  #id = 0
  #stopped = true
  /** Running but unscheduled: the motion set drained, so no callback is pending. */
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

  /** Manually advance one frame (one reference gap: `1000 / fps`, or 1000/60 uncapped). */
  tick() {
    this.#step(this.#gap)
  }

  /** Request the next frame, or sleep when there is nothing to animate. */
  #schedule() {
    if (this.#motion.size === 0) {
      this.#sleeping = true
      this.#acc = 0
    } else {
      this.#sleeping = false
      this.#id = request((t) => this.#onFrame(t))
    }
  }

  /**
   * Wake hook, fired by the motion set on its empty→non-empty transition.
   * Re-anchors the clock, so time spent asleep never reaches the simulation.
   */
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

      // If the browser tab was backgrounded or the system lagged,
      // clamp the elapsed time so the simulation doesn't jump.
      const elapsed = wallElapsed > this.#lagThreshold ? this.#adjustedLag : wallElapsed

      this.#acc += elapsed

      // Frame-paced cap: tick once the accumulated time reaches the cap gap,
      // with half of the current frame as tolerance so a cap near a multiple
      // of the display cadence can't alias against vsync (a knife-edge
      // crossing would let timestamp jitter flip between an N- and an
      // (N+1)-frame gap). Uncapped, the gap is 0 and every frame ticks.
      if (this.#acc + elapsed / 2 >= this.#capGap) {
        const delta = this.#acc
        this.#acc = 0
        this.#step(delta)
      }
    } else {
      // The first callback after (re)scheduling only anchors the clock: rAF
      // timestamps sit on the frame grid, not on performance.now()'s, so a
      // delta bridging the two clocks could be tiny or even negative.
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
