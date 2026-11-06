// Can a Vue ref subscribe to a ramp on read, and drop the subscription
// once nothing reads it? The scheme: each ramp update triggers the ref
// and marks it unread; any read of the ref clears the mark and
// subscribes if needed. If the next update finds the ref still unread,
// no effect re-ran on the last trigger, so nothing tracks the ref and it
// unsubscribes. The ramp here is a bare anchor model (value is a
// function of a clock), standing in for the proposal's catch-up ramp.
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../packages/coily/package.json', import.meta.url))
const vue = require('vue') as typeof import('vue')
const { computed, customRef, effectScope, nextTick, watch, watchEffect } = vue

class AnchorRamp {
  clock = 0
  #anchorTime = 0
  #anchorValue = 0
  readonly listeners = new Set<() => void>()

  readonly rate: number

  constructor(rate: number) {
    this.rate = rate
  }

  get value(): number {
    return this.#anchorValue + (this.rate / 1000) * (this.clock - this.#anchorTime)
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // One frame: the clock always moves; listeners hear about it only
  // while subscribed, which stands in for the ramp joining the tick.
  frame(ms: number): void {
    this.clock += ms
    for (const listener of this.listeners) listener()
  }
}

function rampRef(ramp: AnchorRamp) {
  let trigger: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  let unread = false

  const onUpdate = () => {
    if (unread) {
      unsubscribe!()
      unsubscribe = undefined
      return
    }
    unread = true
    trigger!()
  }

  return customRef((track, trig) => {
    trigger = trig
    return {
      get() {
        track()
        unread = false
        unsubscribe ??= ramp.onUpdate(onUpdate)
        return ramp.value
      },
      set() {},
    }
  })
}

// Real frames: rAF fires after the microtask queue drains, so Vue's
// scheduler flushes between frames.
const frames = async (ramp: AnchorRamp, n: number) => {
  for (let i = 0; i < n; i++) {
    ramp.frame(16)
    await new Promise((resolve) => setTimeout(resolve))
  }
}

const report = (name: string, ok: boolean, detail: string) =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`)

{
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  const seen: number[] = []
  const scope = effectScope()
  scope.run(() => watchEffect(() => seen.push(ref.value)))
  await frames(ramp, 10)
  const subscribedWhileWatched = ramp.listeners.size === 1
  const lastSeen = seen.at(-1)
  scope.stop()
  await frames(ramp, 2)
  report(
    'watchEffect',
    subscribedWhileWatched && ramp.listeners.size === 0 && seen.length === 11 && lastSeen === 160,
    `${seen.length} runs, last ${lastSeen}, subscribed while watched ${subscribedWhileWatched}, listeners after stop ${ramp.listeners.size}`,
  )
}

{
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  const seen: number[] = []
  const scope = effectScope()
  scope.run(() =>
    watch(
      () => ref.value,
      (v) => seen.push(v),
      { flush: 'post' },
    ),
  )
  await frames(ramp, 10)
  report(
    "watch, flush 'post'",
    ramp.listeners.size === 1 && seen.length === 10 && seen.at(-1) === 160,
    `${seen.length} callbacks, last ${seen.at(-1)}, listeners ${ramp.listeners.size}`,
  )
  scope.stop()
}

{
  // A computed read once from plain code has no subscribers of its own,
  // so it never re-reads the ref and the ramp drops it.
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  const doubled = computed(() => ref.value * 2)
  void doubled.value
  await frames(ramp, 3)
  const afterIdle = ramp.listeners.size
  const caughtUp = doubled.value
  report(
    'unwatched computed',
    afterIdle === 0 && caughtUp === 96 && ramp.listeners.size === 1,
    `listeners after idle ${afterIdle}, caught-up read ${caughtUp}`,
  )
}

{
  // A computed that an effect watches keeps the ref subscribed.
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  const doubled = computed(() => ref.value * 2)
  const seen: number[] = []
  const scope = effectScope()
  scope.run(() => watchEffect(() => seen.push(doubled.value)))
  await frames(ramp, 5)
  report(
    'watched computed',
    ramp.listeners.size === 1 && seen.at(-1) === 160,
    `last ${seen.at(-1)}, listeners ${ramp.listeners.size}`,
  )
  scope.stop()
}

{
  // Handler-only reads: subscribe for one frame, then drop. A later read
  // still sees where the ramp would be.
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  void ref.value
  await frames(ramp, 1)
  const afterOne = ramp.listeners.size
  await frames(ramp, 1)
  const afterTwo = ramp.listeners.size
  await frames(ramp, 60)
  report(
    'handler reads',
    afterOne === 1 && afterTwo === 0 && ref.value === 992,
    `listeners after 1 frame ${afterOne}, after 2 ${afterTwo}, read after 62 frames ${ref.value}`,
  )
}

{
  // Manual stepping with no flush between frames: the second frame finds
  // the ref unread and drops it, but the pending effect still runs, reads
  // the caught-up value, and resubscribes.
  const ramp = new AnchorRamp(1000)
  const ref = rampRef(ramp)
  const seen: number[] = []
  const scope = effectScope()
  scope.run(() => watchEffect(() => seen.push(ref.value)))
  ramp.frame(16)
  ramp.frame(16)
  const droppedEarly = ramp.listeners.size === 0
  await nextTick()
  const resubscribed = ramp.listeners.size === 1
  await frames(ramp, 3)
  report(
    'sync double step',
    resubscribed && seen.at(-1) === 80,
    `dropped early ${droppedEarly}, resubscribed after flush ${resubscribed}, last ${seen.at(-1)}`,
  )
  scope.stop()
}
