import type { MotionSet } from './motion-set.ts'
import { invariant } from './util.ts'

/** Frame timing options for a spring system. */
export interface TickerOptions {
  /**
   * Frame-rate cap, in frames per second. 0 means uncapped: one tick per
   * displayed frame, at whatever rate the screen runs. Capped ticks land
   * on whole display frames near the requested rate, and each receives
   * the true elapsed time. Must be >= 0.
   * @default 0
   */
  readonly fps?: number | undefined
  /**
   * The longest frame gap, in ms, that counts as a normal frame. A longer
   * gap, such as a backgrounded tab or a blocking task, is lag, and the
   * ticker replaces it with `adjustedLag` so springs do not teleport. 0
   * disables lag clamping and reads back as 0. Must be >= 0.
   * @default 500
   */
  readonly lagThreshold?: number | undefined
  /**
   * The elapsed time, in ms, that replaces a lagging frame, capped at
   * `lagThreshold` ms. It reads back as given, even above `lagThreshold`.
   * Must be >= 0.
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

const now = (): number => performance.now()

/**
 * Drives a `MotionSet` from animation frames, pacing fps caps to whole
 * display frames and clamping lag. It requests frames only while the set
 * has motions, and otherwise sleeps until the set's `onWake` rearms it.
 *
 * While started and asleep, it credits idle wall time to the set's clock,
 * less any time the document is hidden. An awake set gets no frames in a
 * hidden tab, so the gap arrives as one frame, clamped like any lag.
 *
 * Idle time reads the wall clock once per microtask checkpoint, so the
 * clock holds still through synchronous code, as it does between frames.
 */
export class Ticker {
  #fps: number
  #gap: number
  #capGap: number
  #lagThreshold: number
  #adjustedLag: number
  /** Frame gaps longer than this count as lag: `#lagThreshold`, or Infinity when 0 disables clamping. */
  #lagLimit = 0
  /** The ms a lagging frame steps: `#adjustedLag` clamped to `#lagThreshold`. */
  #lagStep = 0

  readonly #motions: MotionSet
  readonly #onVisibility = () => this.#onVisibilityChange()

  #frame = 0
  #time = 0
  #delta = 0
  #acc = 0
  #lastWallTime = 0
  #primed = false

  #id = 0
  #stopped = true
  #sleeping = false
  /** Whether a frame callback is running. Its `finally` schedules the next frame. */
  #inFrame = false

  /** Wall ms when the current idle spell began, or null outside one. */
  #idleSince: number | null = null
  /** Hidden ms already closed out within the current idle spell. */
  #hiddenIdle = 0
  /** Wall ms when the document was last hidden, or null while visible. */
  #hiddenSince: number | null = null
  /** The wall ms synchronous code reads until the next microtask checkpoint, or null until it first reads. */
  #taskTime: number | null = null
  /** The latest task time, so a frame never credits the clock back past a read. */
  #lastTaskTime = 0

  constructor(motions: MotionSet, options?: TickerOptions) {
    this.#motions = motions

    const fps = options?.fps ?? 0
    const lagThreshold = options?.lagThreshold ?? 500
    const adjustedLag = options?.adjustedLag ?? 33

    invariant(fps >= 0, 'FPS must be greater than or equal to 0')
    invariant(lagThreshold >= 0, 'Lag threshold must be greater than or equal to 0')
    invariant(adjustedLag >= 0, 'Adjusted lag must be greater than or equal to 0')

    this.#fps = fps
    this.#gap = fps === 0 ? 1000 / 60 : 1000 / fps
    this.#capGap = fps === 0 ? 0 : 1000 / fps
    this.#lagThreshold = lagThreshold
    this.#adjustedLag = adjustedLag
    this.#updateLag()

    motions.onWake = () => this.#wake()
    motions.idleTime = () => (this.#idleSince === null ? 0 : this.#idleMs(this.#taskNow()) / 1000)

    if (typeof document !== 'undefined') {
      if (document.visibilityState === 'hidden') this.#hiddenSince = this.#taskNow()
      document.addEventListener('visibilitychange', this.#onVisibility)
    }
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
    this.#lagThreshold = value
    this.#updateLag()
  }

  get adjustedLag() {
    return this.#adjustedLag
  }

  set adjustedLag(value: number) {
    invariant(value >= 0, 'Adjusted lag must be greater than or equal to 0')
    this.#adjustedLag = value
    this.#updateLag()
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
      // Inside a frame, the frame's `finally` schedules. Scheduling here
      // too would request a second callback.
      if (!this.#inFrame) this.#schedule(this.#taskNow())
    }
  }

  stop() {
    if (!this.#stopped) {
      if (!this.#sleeping) {
        cancel(this.#id)
      }
      this.#stopped = true
      this.#sleeping = false
      // A stopped system freezes its clock, as it holds its springs.
      this.#creditIdle(this.#taskNow())
    }
  }

  tick() {
    this.#step(this.#gap)
  }

  /** Stops the ticker and removes its document listener. */
  dispose() {
    this.stop()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.#onVisibility)
    }
  }

  #schedule(timestamp: number) {
    if (this.#motions.size === 0) {
      this.#sleeping = true
      this.#acc = 0
      if (this.#idleSince === null) {
        this.#idleSince = timestamp
        this.#hiddenIdle = 0
      }
    } else {
      this.#sleeping = false
      this.#id = request((t) => this.#onFrame(t))
    }
  }

  #wake() {
    if (!this.#stopped && this.#sleeping) {
      this.#primed = false
      this.#schedule(this.#taskNow())
    }
  }

  #onFrame(timestamp: number) {
    if (this.#stopped) return

    this.#inFrame = true
    try {
      if (this.#primed) {
        const wallElapsed = timestamp - this.#lastWallTime
        const elapsed = wallElapsed > this.#lagLimit ? this.#lagStep : wallElapsed

        this.#acc += elapsed

        // Stepping within half a frame of the cap gap lands capped ticks on
        // the nearest display frame instead of always overshooting.
        if (this.#acc + elapsed / 2 >= this.#capGap) {
          const delta = this.#acc
          this.#acc = 0
          this.#step(delta)
        }
      } else {
        // The first frame after start or wake only sets the baseline, and
        // idle time runs up to it. Its timestamp marks the frame's start and
        // can precede a read made before this callback, so credit up to the
        // later one to keep the clock from running backward.
        this.#primed = true
        this.#creditIdle(Math.max(timestamp, this.#lastTaskTime))
      }
    } finally {
      this.#lastWallTime = timestamp
      // Scheduling in `finally` keeps the loop running when a listener
      // throws, and the exception still surfaces. Skip only if a listener
      // stopped the ticker mid-step.
      this.#inFrame = false
      if (!this.#stopped) {
        this.#schedule(timestamp)
      }
    }
  }

  // Settings keep what the user wrote, and frames read these derived
  // values. An Infinity limit disables clamping without a per-frame branch.
  #updateLag() {
    this.#lagLimit = this.#lagThreshold === 0 ? Number.POSITIVE_INFINITY : this.#lagThreshold
    this.#lagStep = Math.min(this.#adjustedLag, this.#lagThreshold)
  }

  // Idle wall ms since the spell began, less hidden time within it.
  #idleMs(timestamp: number): number {
    const since = this.#idleSince
    if (since === null) return 0
    let hidden = this.#hiddenIdle
    if (this.#hiddenSince !== null) hidden += timestamp - Math.max(this.#hiddenSince, since)
    return Math.max(0, timestamp - since - hidden)
  }

  // Wall ms, read once per microtask checkpoint so synchronous code sees
  // one moment.
  #taskNow(): number {
    if (this.#taskTime === null) {
      const time = now()
      this.#taskTime = time
      this.#lastTaskTime = time
      queueMicrotask(() => {
        this.#taskTime = null
      })
    }
    return this.#taskTime
  }

  #creditIdle(timestamp: number) {
    if (this.#idleSince === null) return
    this.#motions.credit(this.#idleMs(timestamp) / 1000)
    this.#idleSince = null
  }

  #onVisibilityChange() {
    const timestamp = this.#taskNow()
    if (document.visibilityState === 'hidden') {
      this.#hiddenSince ??= timestamp
    } else if (this.#hiddenSince !== null) {
      if (this.#idleSince !== null) {
        this.#hiddenIdle += Math.max(0, timestamp - Math.max(this.#hiddenSince, this.#idleSince))
      }
      this.#hiddenSince = null
    }
  }

  #step(dt: number) {
    this.#time += dt
    this.#frame++
    this.#delta = dt

    this.#motions.tick(dt / 1000)
  }
}
