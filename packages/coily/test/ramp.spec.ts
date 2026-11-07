import { afterEach, describe, expect, test, vi } from 'vitest'
import { createSpringSystem, defineSpring, mapSpring, targetOf, velocityOf } from '../src/index.ts'
import { MotionSet } from '../src/motion-set.ts'
import { Ramp } from '../src/ramp.ts'
import { Ticker, type TickerOptions } from '../src/ticker.ts'
import { FRAME, flush } from './helpers.ts'

const smooth = defineSpring({ duration: 300, dampingRatio: 1 })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createRamp', () => {
  test('starts at rest at `from` without a target', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(5, { rate: 100 })
    expect(ramp.value).toBeCloseTo(5, 9)
    expect(ramp.target).toBe(5)
    expect(ramp.isResting).toBe(true)
    expect(ramp.velocity).toBe(0)
    expect(ramp.acceleration).toBe(0)
    expect(ramp.timeRemaining).toBe(0)
    expect(ramp.purpose).toBe('motion')
  })

  test('moves toward its target at its rate and stops there', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 400, target: 100 })
    expect(ramp.velocity).toBe(400)
    expect(ramp.timeRemaining).toBeCloseTo(250)

    system.advance(100)
    expect(ramp.value).toBeCloseTo(40, 10)
    expect(ramp.isResting).toBe(false)

    system.advance(200)
    expect(ramp.value).toBe(100)
    expect(ramp.isResting).toBe(true)
    expect(ramp.velocity).toBe(0)
  })

  test('moves downward toward a lower target', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(10, { rate: 5, target: 0 })
    expect(ramp.velocity).toBe(-5)
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(5, 10)
  })

  test('an infinite target is endless', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 270, target: Infinity })
    expect(ramp.timeRemaining).toBe(Infinity)
    for (let i = 0; i < 60; i++) system.advance(FRAME)
    expect(ramp.value).toBeCloseTo(270, 9)
    expect(ramp.isResting).toBe(false)

    const down = system.createRamp(0, { rate: 1, target: -Infinity })
    system.advance(1000)
    expect(down.value).toBeCloseTo(-1, 12)
  })

  test('rejects invalid options', () => {
    const system = createSpringSystem()
    expect(() => system.createRamp(Number.NaN, { rate: 1 })).toThrow('Ramp value')
    expect(() => system.createRamp(Infinity, { rate: 1 })).toThrow('Ramp value')
    expect(() => system.createRamp(0, { rate: -1 })).toThrow('Ramp rate')
    expect(() => system.createRamp(0, { rate: Infinity })).toThrow('Ramp rate')
    expect(() => system.createRamp(0, { rate: 1, target: Number.NaN })).toThrow('Ramp target')
    expect(() =>
      // @ts-expect-error 'appearance' is not a Purpose
      system.createRamp(0, { rate: 1, purpose: 'appearance' }),
    ).toThrow("Ramp purpose must be 'motion' or 'nonmotion'")
  })
})

describe('writes', () => {
  test('assigning value moves the ramp and keeps its target and rate', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 10, target: 100 })
    const onUpdate = vi.fn()
    ramp.onUpdate(onUpdate)

    ramp.value = 50
    expect(ramp.value).toBe(50)
    expect(onUpdate).toHaveBeenCalledOnce()
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(60, 10)
    expect(ramp.target).toBe(100)

    // One update came from the write above and one from the frame.
    // Writing the current value adds none.
    const current = ramp.value
    ramp.value = current
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  test('assigning target heads there from the current value', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 10, target: 100 })
    system.advance(1000)
    ramp.target = 0
    expect(ramp.velocity).toBe(-10)
    system.advance(500)
    expect(ramp.value).toBeCloseTo(5, 10)
  })

  test('assigning rate applies from the current value', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 10, target: 100 })
    system.advance(1000)
    ramp.rate = 20
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(30, 10)

    ramp.rate = 0
    expect(ramp.isResting).toBe(true)
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(30, 10)
    expect(() => {
      ramp.rate = -1
    }).toThrow('Ramp rate')
  })

  test('jumpTo rests the ramp at the value', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 10, target: Infinity })
    const onStop = vi.fn()
    ramp.onStop(onStop)
    ramp.jumpTo(42)
    expect(ramp.value).toBe(42)
    expect(ramp.target).toBe(42)
    expect(ramp.isResting).toBe(true)
    expect(onStop).toHaveBeenCalledOnce()
  })
})

describe('events', () => {
  test('a watched ramp updates every frame, then stops on arrival', async () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1000, target: 100 })
    const onUpdate = vi.fn()
    const onStop = vi.fn()
    ramp.onUpdate(onUpdate)
    ramp.onStop(onStop)
    let settled = false
    void ramp.settled.then(() => {
      settled = true
    })

    for (let i = 0; i < 5; i++) system.advance(16)
    expect(onUpdate).toHaveBeenCalledTimes(5)
    expect(onStop).not.toHaveBeenCalled()

    for (let i = 0; i < 5; i++) system.advance(16)
    expect(ramp.value).toBe(100)
    expect(onUpdate).toHaveBeenCalledTimes(7)
    expect(onStop).toHaveBeenCalledOnce()
    await flush()
    expect(settled).toBe(true)
  })

  test('start and stop alternate across retargets', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1000 })
    const events: string[] = []
    ramp.onStart(() => events.push('start'))
    ramp.onStop(() => events.push('stop'))

    ramp.target = 10
    ramp.target = 20
    for (let i = 0; i < 3; i++) system.advance(16)
    ramp.target = 0
    for (let i = 0; i < 3; i++) system.advance(16)
    expect(events).toEqual(['start', 'stop', 'start', 'stop'])
  })

  test('start fires on every departure, even after an arrival nobody watched', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1000 })
    const events: string[] = []
    ramp.onStart(() => events.push('start'))

    ramp.target = 10
    system.advance(100)
    ramp.target = 20
    system.advance(100)
    ramp.target = 30
    system.advance(100)
    ramp.value = 0
    ramp.rate = 0
    ramp.rate = 1000
    expect(events).toEqual(['start', 'start', 'start', 'start', 'start'])
  })

  test('a ramp retargeted in the frame it arrives keeps ticking', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    // The spring enters the tick first, so its listener runs before the
    // ramp's own end of frame.
    const spring = system.createSpring(0, smooth)
    spring.target = 100
    const ramp = system.createRamp(0, { rate: 1000, target: 10 })
    const onUpdate = vi.fn()
    ramp.onUpdate(onUpdate)
    let retargeted = false
    spring.onUpdate(() => {
      if (retargeted) return
      retargeted = true
      ramp.target = 1000
    })

    system.advance(16)
    onUpdate.mockClear()
    for (let i = 0; i < 5; i++) system.advance(16)
    expect(onUpdate).toHaveBeenCalledTimes(5)

    const follower = system.createSpring(ramp, smooth)
    for (let i = 0; i < 5; i++) system.advance(16)
    expect(follower.target).toBe(ramp.value)
  })

  test('an arrival nobody watched stays silent, even to a later stop listener', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1000, target: 10 })
    system.advance(100)
    const onStop = vi.fn()
    ramp.onStop(onStop)
    system.advance(16)
    expect(onStop).not.toHaveBeenCalled()
    expect(ramp.isResting).toBe(true)
  })
})

describe('subscription', () => {
  test('a ramp ticks only while something needs it frame by frame', () => {
    const motions = new MotionSet()
    const ramp = new Ramp(motions, 0, { rate: 10, target: 100 })
    expect(motions.size).toBe(0)

    const offStart = ramp.onStart(() => {})
    expect(motions.size).toBe(0)

    const offUpdate = ramp.onUpdate(() => {})
    expect(motions.size).toBe(1)
    offUpdate()
    expect(motions.size).toBe(0)

    // A bounded ramp ticks for stop listeners and a pending settled.
    const offStop = ramp.onStop(() => {})
    expect(motions.size).toBe(1)
    offStop()
    expect(motions.size).toBe(0)
    void ramp.settled
    expect(motions.size).toBe(1)
    offStart()
  })

  test('an endless ramp ignores stop listeners until it gets a bounded target', () => {
    const motions = new MotionSet()
    const ramp = new Ramp(motions, 0, { rate: 10, target: Infinity })
    ramp.onStop(() => {})
    expect(motions.size).toBe(0)
    ramp.target = 100
    expect(motions.size).toBe(1)
  })

  test('an unwatched ramp catches up to where it would have been', () => {
    const system = createSpringSystem()
    const watched = system.createRamp(0, { rate: 270, target: Infinity })
    const unwatched = system.createRamp(0, { rate: 270, target: Infinity })
    watched.onUpdate(() => {})

    const off = unwatched.onUpdate(() => {})
    for (let i = 0; i < 30; i++) system.advance(FRAME)
    off()
    for (let i = 0; i < 30; i++) system.advance(FRAME)
    expect(unwatched.value).toBeCloseTo(watched.value, 9)

    unwatched.onUpdate(() => {})
    for (let i = 0; i < 30; i++) system.advance(FRAME)
    expect(unwatched.value).toBeCloseTo(watched.value, 9)
    expect(unwatched.value).toBeCloseTo(405, 9)
  })

  test('a follower that detaches and reattaches retargets to the ramp further along', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 100, target: Infinity })
    const spring = system.createSpring(ramp, smooth)
    for (let i = 0; i < 10; i++) system.advance(FRAME)
    const detached = spring.target
    spring.target = detached
    for (let i = 0; i < 60; i++) system.advance(FRAME)
    spring.target = ramp
    expect(spring.target).toBeCloseTo(ramp.value, 12)
    expect(ramp.value).toBeCloseTo((100 * (70 * FRAME)) / 1000, 9)
  })
})

describe('followers', () => {
  test('a spring following an endless ramp settles to the exact steady lag', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const rate = 270
    const ramp = system.createRamp(0, { rate, target: Infinity })
    const spring = system.createSpring(ramp, smooth)
    for (let i = 0; i < 240; i++) system.advance(FRAME)
    // A critically damped spring chasing a target moving at a steady
    // speed trails it by (damping / tension) * speed.
    const lag = (smooth.damping / smooth.tension) * rate
    expect(ramp.value - spring.value).toBeCloseTo(lag, 6)
    expect(spring.velocity).toBeCloseTo(rate, 6)
  })

  test('the frame rate does not change where a ramp follower lands', () => {
    function run(frame: number, frames: number) {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const ramp = system.createRamp(0, { rate: 400, target: 180 })
      const spring = system.createSpring(ramp, smooth)
      const trail: number[] = []
      for (let i = 0; i < frames; i++) {
        system.advance(frame)
        trail.push(spring.value)
      }
      return trail
    }
    // 32 ms frames put the arrival at 450 ms, mid-frame. The 1 ms run is
    // the reference, sampled at the same instants.
    const coarse = run(32, 30)
    const fine = run(1, 960)
    let worst = 0
    for (let i = 0; i < coarse.length; i++) {
      worst = Math.max(worst, Math.abs(coarse[i]! - fine[32 * (i + 1) - 1]!))
    }
    expect(worst).toBeLessThan(0.01)
  })

  test('only the default arrival integrates a ramp exactly', () => {
    function land(arrival: 'passthrough' | 'stop' | number, frame: number, frames: number) {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const ramp = system.createRamp(0, { rate: 1000, target: Infinity })
      const spring = system.createSpring(
        ramp,
        defineSpring({ duration: 300, dampingRatio: 1, arrival }),
      )
      for (let i = 0; i < frames; i++) system.advance(frame)
      return spring.value
    }
    // Exact integration lands in the same place whatever the frame size.
    expect(land('passthrough', 400, 1)).toBeCloseTo(land('passthrough', 1, 400), 9)
    // Any other arrival holds the target within each sub-step.
    for (const arrival of ['stop', 0.5] as const) {
      expect(Math.abs(land(arrival, 400, 1) - land(arrival, 1, 400))).toBeGreaterThan(1)
    }
  })

  test('derives velocity and target sources', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const ramp = system.createRamp(0, { rate: 50, target: 100 })
    const remaining = system.createSpring(
      mapSpring({ value: ramp, target: targetOf(ramp) }, (v) => v.target - v.value),
    )
    const speed = system.createSpring(velocityOf(ramp))
    expect(remaining.target).toBe(100)
    expect(speed.target).toBe(50)
    for (let i = 0; i < 400; i++) system.advance(FRAME)
    expect(remaining.target).toBe(0)
    expect(speed.target).toBe(0)
  })

  test('a spring cannot follow the target of an endless ramp', () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1, target: Infinity })
    expect(() => system.createSpring(targetOf(ramp))).toThrow('finite')
  })
})

describe('dispose', () => {
  test('stops the ramp where it is and detaches followers', async () => {
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 100, target: 100 })
    const spring = system.createSpring(ramp)
    let settled = false
    void ramp.settled.then(() => {
      settled = true
    })
    system.advance(500)
    const value = ramp.value
    ramp.dispose()
    ramp.dispose()
    await flush()
    expect(settled).toBe(true)

    system.advance(500)
    expect(ramp.value).toBe(value)
    expect(ramp.isResting).toBe(true)
    expect(spring.target).toBe(value)
    expect(() => {
      ramp.target = 0
    }).toThrow('disposed ramp')
  })
})

describe('reduced motion', () => {
  function stubMatchMedia(initialMatches: boolean) {
    let listener: ((event: { matches: boolean }) => void) | undefined
    vi.stubGlobal('window', {
      matchMedia: () => ({
        matches: initialMatches,
        addEventListener: (_: string, callback: (event: { matches: boolean }) => void) => {
          listener = callback
        },
      }),
    })
    return (matches: boolean) => listener?.({ matches })
  }

  test('a bounded ramp jumps to its target', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const ramp = system.createRamp(0, { rate: 10, target: 100 })
    expect(ramp.value).toBe(100)
    expect(ramp.isResting).toBe(true)

    const onUpdate = vi.fn()
    ramp.onUpdate(onUpdate)
    ramp.target = 50
    expect(ramp.value).toBe(50)
    expect(onUpdate).toHaveBeenCalledOnce()
  })

  test('an endless ramp holds still', () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const ramp = system.createRamp(5, { rate: 10, target: Infinity })
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(5, 9)
    expect(ramp.isResting).toBe(true)
    expect(ramp.velocity).toBe(0)
  })

  test("a 'nonmotion' ramp keeps moving", () => {
    const system = createSpringSystem({ reducedMotion: 'always' })
    const clock = system.createRamp(0, { rate: 1000, target: 600, purpose: 'nonmotion' })
    expect(clock.purpose).toBe('nonmotion')
    system.advance(300)
    expect(clock.value).toBeCloseTo(300, 9)
  })

  test('turning on finishes bounded ramps and holds endless ones, watched or not', () => {
    const setReduced = stubMatchMedia(false)
    const system = createSpringSystem()
    const bounded = system.createRamp(0, { rate: 10, target: 100 })
    const endless = system.createRamp(0, { rate: 10, target: Infinity })
    const follower = system.createSpring(endless)
    const events: string[] = []
    endless.onStop(() => events.push('stop'))
    endless.onStart(() => events.push('start'))
    system.advance(1000)

    setReduced(true)
    expect(bounded.value).toBe(100)
    expect(endless.value).toBeCloseTo(10, 10)
    expect(endless.isResting).toBe(true)
    expect(events).toEqual(['stop'])
    expect(follower.value).toBeCloseTo(10, 10)

    system.advance(1000)
    expect(endless.value).toBeCloseTo(10, 10)

    // A value written while held is where it resumes from.
    endless.value = 20
    setReduced(false)
    expect(events).toEqual(['stop', 'start'])
    system.advance(1000)
    expect(endless.value).toBeCloseTo(30, 10)
  })
})

describe('the system clock', () => {
  class Frames {
    now = 0
    #callbacks: FrameRequestCallback[] = []
    #visibility: () => void = () => {}
    hidden = false

    install() {
      vi.stubGlobal('performance', { now: () => this.now })
      vi.stubGlobal('window', {
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          this.#callbacks.push(callback)
          return this.#callbacks.length
        },
        cancelAnimationFrame: () => {
          this.#callbacks.length = 0
        },
      })
      const visibility = () => (this.hidden ? 'hidden' : 'visible')
      vi.stubGlobal('document', {
        get visibilityState() {
          return visibility()
        },
        addEventListener: (_: string, callback: () => void) => {
          this.#visibility = callback
        },
      })
      return this
    }

    // Wall time passes between tasks, so each step starts a new one.
    async wait(ms: number) {
      await nextTask()
      this.now += ms
    }

    async frame(ms: number) {
      await nextTask()
      this.now += ms
      const pending = this.#callbacks
      this.#callbacks = []
      for (const callback of pending) callback(this.now)
    }

    async setHidden(hidden: boolean) {
      await nextTask()
      this.hidden = hidden
      this.#visibility()
    }
  }

  const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve))

  test('counts idle time while started and asleep', async () => {
    const frames = new Frames().install()
    const motions = new MotionSet()
    const ticker = new Ticker(motions)
    const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    ticker.start()
    await frames.wait(250)
    expect(ramp.value).toBe(250)
  })

  test('does not count time while stopped or hidden', async () => {
    const frames = new Frames().install()
    const motions = new MotionSet()
    const ticker = new Ticker(motions)
    const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    ticker.start()
    await frames.wait(100)
    ticker.stop()
    await frames.wait(1000)
    expect(ramp.value).toBe(100)

    ticker.start()
    await frames.wait(100)
    await frames.setHidden(true)
    await frames.wait(5000)
    expect(ramp.value).toBe(200)
    await frames.setHidden(false)
    await frames.wait(50)
    expect(ramp.value).toBe(250)
  })

  test('an awake system counts a hidden spell as one frame, clamped as lag', async () => {
    const cases: [TickerOptions, number, number][] = [
      [{}, 5000, 33],
      [{}, 300, 300],
      [{ lagThreshold: 0 }, 5000, 5000],
    ]
    for (const [options, hiddenMs, counted] of cases) {
      const frames = new Frames().install()
      const motions = new MotionSet()
      const ticker = new Ticker(motions, options)
      const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
      ramp.onUpdate(() => {})
      ticker.start()
      await frames.frame(16) // priming frame
      await frames.frame(16)
      expect(ramp.value).toBeCloseTo(16, 9)

      // No frames arrive while hidden, so the spell lands on the next one.
      await frames.setHidden(true)
      await frames.wait(hiddenMs)
      await frames.setHidden(false)
      await frames.frame(0)
      expect(ramp.value).toBeCloseTo(16 + counted, 9)
      ticker.stop()
    }
  })

  test('hands over from idle time to frames without a gap', async () => {
    const frames = new Frames().install()
    const motions = new MotionSet()
    const ticker = new Ticker(motions)
    const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    const reference = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    ticker.start()
    await frames.wait(100)

    const seen: number[] = []
    ramp.onUpdate(() => seen.push(ramp.value))
    expect(ramp.value).toBe(100)
    // The first frame after waking primes, and frames step from there.
    await frames.frame(16)
    await frames.frame(16)
    await frames.frame(16)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBeCloseTo(132, 9)
    expect(seen[1]).toBeCloseTo(148, 9)
    expect(reference.value).toBeCloseTo(148, 9)
  })

  test('holds still through synchronous code while asleep', async () => {
    const frames = new Frames().install()
    const motions = new MotionSet()
    const ticker = new Ticker(motions)
    ticker.start()
    await frames.wait(100)

    // A ramp created and read in one synchronous run reads its starting
    // value, as a hydrating render needs it to.
    const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    frames.now += 5
    expect(ramp.value).toBe(0)
    expect(motions.time).toBe(0.1)

    await frames.wait(0)
    expect(ramp.value).toBeCloseTo(5, 9)
  })

  test('never runs backward when a frame starts before a read', async () => {
    const frames = new Frames().install()
    const motions = new MotionSet()
    const ticker = new Ticker(motions)
    const ramp = new Ramp(motions, 0, { rate: 1000, target: Infinity })
    ticker.start()
    await frames.wait(100)
    expect(ramp.value).toBe(100)

    // The subscription wakes the ticker, and the frame's timestamp
    // predates the last read.
    ramp.onUpdate(() => {})
    await nextTask()
    frames.now -= 2
    await frames.frame(0)
    expect(motions.time).toBe(0.1)
    expect(ramp.value).toBe(100)
  })

  test('manual stepping alone never counts wall time', async () => {
    const frames = new Frames().install()
    const system = createSpringSystem()
    const ramp = system.createRamp(0, { rate: 1000, target: Infinity })
    await frames.wait(500)
    expect(ramp.value).toBe(0)
    system.advance(16)
    expect(ramp.value).toBe(16)
  })
})
