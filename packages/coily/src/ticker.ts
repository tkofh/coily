type Request = (callback: (v: number | boolean) => void) => number

export type TickCallback = (time: number, delta: number, frame: number) => void

export interface TickerOptions {
  fps?: number
  lagThreshold?: number
  adjustedLag?: number
  stopped?: boolean
}

export interface Ticker {
  fps: number
  lagThreshold: number
  adjustedLag: number
  readonly time: number
  readonly frame: number
  readonly delta: number
  readonly deltaRatio: number
  start: () => void
  stop: () => void
  add: (callback: TickCallback) => void
  remove: (callback: TickCallback) => void
  once: (callback: TickCallback) => void
  tick: () => void
}

export const defaultOptions: Required<TickerOptions> = {
  fps: 60,
  lagThreshold: 500,
  adjustedLag: 33,
  stopped: false,
}

export const createTicker = (options?: TickerOptions): Ticker => {
  const getTime = Date.now

  let fps = options?.fps ?? defaultOptions.fps

  let lagThreshold = options?.lagThreshold ?? defaultOptions.lagThreshold
  let adjustedLag = options?.adjustedLag ?? defaultOptions.adjustedLag

  let lagAdjustedStartTime = getTime()
  let lagAdjustedLastUpdate = lagAdjustedStartTime

  let gap = 1000 / fps

  const listeners = new Set<TickCallback>()

  let frame = 0

  let previousTime = 0
  let time = 0
  let nextTime = gap
  let delta = 0

  const hasWindow = typeof window !== 'undefined'
  let id = 0
  const request: Request = hasWindow
    ? window.requestAnimationFrame
    : (callback): number =>
        (setTimeout as (typeof window)['setTimeout'])(callback, (nextTime - previousTime + 1) | 0)
  const cancel = hasWindow ? window.cancelAnimationFrame : clearTimeout

  const tick = (v: boolean | number) => {
    const elapsed = getTime() - lagAdjustedLastUpdate
    const manual = v === true
    if (elapsed > lagThreshold) {
      lagAdjustedStartTime += elapsed - adjustedLag
    }
    lagAdjustedLastUpdate += elapsed
    time = lagAdjustedLastUpdate - lagAdjustedStartTime

    let dispatch = false

    const overlap = time - nextTime
    if (overlap > 0 || manual) {
      frame++
      delta = time - previousTime
      previousTime = time
      nextTime += overlap + (overlap >= gap ? 4 : gap - overlap)
      dispatch = true
    }
    if (!manual) {
      id = request(tick)
    }
    if (dispatch) {
      for (const listener of listeners.values()) {
        listener(time, delta, frame)
      }
    }
  }

  let stopped = options?.stopped ?? defaultOptions.stopped

  if (!stopped) {
    tick(0)
  }

  return {
    get frame(): number {
      return frame
    },
    get delta(): number {
      return delta
    },
    get time(): number {
      return time
    },
    get deltaRatio(): number {
      return delta / gap
    },

    get fps(): number {
      return fps
    },
    set fps(value: number) {
      fps = value
      gap = 1000 / fps
      nextTime = previousTime + gap
    },
    get lagThreshold(): number {
      return lagThreshold
    },
    set lagThreshold(value: number) {
      lagThreshold = value === 0 ? 1e8 : value
      adjustedLag = Math.min(adjustedLag, lagThreshold, 0)
    },
    get adjustedLag(): number {
      return adjustedLag
    },
    set adjustedLag(value: number) {
      adjustedLag = Math.min(value, lagThreshold, 0)
    },

    start: () => {
      if (stopped) {
        id = request(tick)
        stopped = false
      }
    },
    stop: () => {
      if (!stopped) {
        cancel(id)
        stopped = true
      }
    },

    add: (callback: TickCallback) => {
      listeners.add(callback)
    },
    remove: (callback: TickCallback) => {
      listeners.delete(callback)
    },
    once: (callback: TickCallback) => {
      const cb = (...args: Parameters<TickCallback>) => {
        callback(...args)
        listeners.delete(cb)
      }
      listeners.add(cb)
    },
    tick: () => {
      tick(true)
    },
  }
}
