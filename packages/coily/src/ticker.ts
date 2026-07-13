import type { MotionSet } from './motion-set.ts'
import { invariant } from './util.ts'

/** Frame timing options for a spring system. */
export interface TickerOptions {
  /**
   * Frame-rate cap. 0 means uncapped: one tick per displayed frame,
   * whatever rate the screen runs at — 60Hz, 120Hz, or adaptive. Capped
   * ticks are paced to whole display frames, near the requested rate, and
   * each still receives the true elapsed time.
   * @default 0
   */
  readonly fps?: number | undefined
  /**
   * Frame gap in milliseconds above which the gap is treated as lag — a
   * backgrounded tab, a blocking task — and replaced with `adjustedLag`,
   * so springs don't teleport when frames resume. 0 disables lag
   * clamping.
   * @default 500
   */
  readonly lagThreshold?: number | undefined
  /**
   * The elapsed milliseconds a lagging frame is replaced with. Clamped to
   * at most `lagThreshold`.
   * @default 33
   */
  readonly adjustedLag?: number | undefined
}

// The setTimeout fallback keeps systems ticking outside the browser:
// SSR, tests, node scripts.
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

/**
 * Drives a `MotionSet` from animation frames. Schedules frames only
 * while motions exist — otherwise it sleeps and the set's `onWake`
 * rearms it — paces fps caps to whole display frames, and clamps lag
 * gaps.
 */
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
    // 0 disables clamping; a threshold no real frame gap reaches avoids
    // a separate disabled branch per frame.
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

    try {
      if (this.#primed) {
        const wallElapsed = timestamp - this.#lastWallTime
        const elapsed = wallElapsed > this.#lagThreshold ? this.#adjustedLag : wallElapsed

        this.#acc += elapsed

        // Step once the accumulated time is within half a frame of the cap
        // gap: capped ticks land on the nearest display frame instead of
        // always overshooting the requested rate.
        if (this.#acc + elapsed / 2 >= this.#capGap) {
          const delta = this.#acc
          this.#acc = 0
          this.#step(delta)
        }
      } else {
        // The first frame after start or wake only records a baseline
        // timestamp; stepping begins on the second.
        this.#primed = true
      }
    } finally {
      this.#lastWallTime = timestamp
      // Scheduling in a finally survives listeners that throw out of the
      // step: the exception still surfaces from the frame callback, but
      // the loop keeps running. Skip only when a listener stopped the
      // ticker mid-step.
      if (!this.#stopped) {
        this.#schedule()
      }
    }
  }

  #step(dt: number) {
    this.#time += dt
    this.#frame++
    this.#delta = dt

    this.#motion.tick(dt / 1000)
  }
}
