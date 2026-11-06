import { describe, expect, test } from 'vitest'
import {
  computed,
  defineComponent,
  effectScope,
  h,
  nextTick,
  ref,
  watch,
  watchEffect,
  type PropType,
} from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem, targetOf, velocityOf, type SpringSystem } from '../../src/index.ts'
import type { Ramp } from '../../src/ramp.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useRamp, type RampRef } from '../../src/vue/ramp.ts'
import { useSpring, type SpringRef } from '../../src/vue/spring.ts'

// Counts the live update subscriptions on the ramp a system creates, so
// tests can see whether the ramp is in the frame loop.
function trackRamps(system: SpringSystem) {
  const tracked = { updates: 0, ramp: undefined as Ramp | undefined }
  const create = system.createRamp.bind(system)
  system.createRamp = (from, options) => {
    const ramp = create(from, options)
    const onUpdate = ramp.onUpdate.bind(ramp)
    ramp.onUpdate = (callback) => {
      tracked.updates++
      const off = onUpdate(callback)
      let active = true
      return () => {
        if (!active) return
        active = false
        tracked.updates--
        off()
      }
    }
    tracked.ramp = ramp
    return ramp
  }
  return tracked
}

function setup(build: () => RampRef) {
  const system = createSpringSystem({ reducedMotion: 'never' })
  const tracked = trackRamps(system)
  let ramp!: RampRef
  const wrapper = mount(
    defineComponent({
      setup() {
        ramp = build()
        return {}
      },
      render: () => h('div'),
    }),
    { global: { provide: { [SpringSystemKey as symbol]: system } } },
  )
  return { system, tracked, ramp, wrapper }
}

// A real frame runs after Vue has flushed the effects the last one
// triggered.
async function frames(system: SpringSystem, count: number, ms = 16) {
  for (let i = 0; i < count; i++) {
    system.advance(ms)
    await nextTick()
  }
}

describe('useRamp', () => {
  test('moves toward the target at the rate', () => {
    const { system, ramp } = setup(() => useRamp(100, 1000, { from: 0 }))
    expect(ramp.value).toBe(0)
    expect(ramp.velocity.value).toBe(1000)
    expect(ramp.timeRemaining.value).toBeCloseTo(100)
    system.advance(50)
    expect(ramp.value).toBeCloseTo(50, 9)
    system.advance(100)
    expect(ramp.value).toBe(100)
    expect(ramp.isResting.value).toBe(true)
  })

  test('starts at rest at the target without `from`', () => {
    const { ramp } = setup(() => useRamp(7, 10))
    expect(ramp.value).toBe(7)
    expect(ramp.isResting.value).toBe(true)
  })

  test('an infinite target needs `from`', () => {
    expect(() => setup(() => useRamp(Infinity, 10))).toThrow('finite `from`')
  })

  test('reactive target and rate drive the ramp', async () => {
    const target = ref(100)
    const rate = ref(10)
    const { system, ramp } = setup(() => useRamp(target, rate, { from: 0 }))
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(10, 9)

    rate.value = 20
    await nextTick()
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(30, 9)

    target.value = 0
    await nextTick()
    system.advance(500)
    expect(ramp.value).toBeCloseTo(20, 9)
  })

  test('writing the ref places the ramp, and jumpTo rests it', () => {
    const { system, ramp } = setup(() => useRamp(Infinity, 10, { from: 0 }))
    ramp.value = 50
    system.advance(1000)
    expect(ramp.value).toBeCloseTo(60, 9)
    ramp.jumpTo(5)
    expect(ramp.value).toBe(5)
    expect(ramp.isResting.value).toBe(true)
  })

  test('isResting reacts to a stop that comes from a write', async () => {
    const rate = ref(10)
    const { system, ramp } = setup(() => useRamp(Infinity, rate, { from: 0 }))
    const seen: boolean[] = []
    const scope = effectScope()
    scope.run(() => watchEffect(() => seen.push(ramp.isResting.value)))
    await frames(system, 2)
    rate.value = 0
    await nextTick()
    expect(seen.at(-1)).toBe(true)
    scope.stop()
  })

  test('a spring follows the ref, and velocityOf and targetOf accept it', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    let ramp!: RampRef
    let spring!: SpringRef
    let speed!: SpringRef
    let destination!: SpringRef
    mount(
      defineComponent({
        setup() {
          ramp = useRamp(100, 50, { from: 0 })
          spring = useSpring(ramp)
          speed = useSpring(velocityOf(ramp))
          destination = useSpring(targetOf(ramp))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )
    expect(speed.value).toBe(50)
    expect(destination.value).toBe(100)
    for (let i = 0; i < 400; i++) system.advance(16)
    expect(spring.value).toBe(100)
    expect(speed.value).toBe(0)
  })

  test('the ramp is disposed with the component', () => {
    const { system, ramp, wrapper } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    system.advance(100)
    wrapper.unmount()
    system.advance(100)
    expect(ramp.value).toBeCloseTo(100, 9)
  })
})

describe('useRamp subscribes on read', () => {
  test('a ramp nobody reads stays out of the frame loop and still moves', () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    system.advance(250)
    expect(tracked.updates).toBe(0)
    expect(ramp.value).toBeCloseTo(250, 9)
  })

  test('a watchEffect keeps the ramp subscribed until its scope stops', async () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    const seen: number[] = []
    const scope = effectScope()
    scope.run(() => watchEffect(() => seen.push(ramp.value)))
    await frames(system, 10)
    expect(tracked.updates).toBe(1)
    expect(seen).toHaveLength(11)
    expect(seen.at(-1)).toBeCloseTo(160, 9)

    scope.stop()
    await frames(system, 2)
    expect(tracked.updates).toBe(0)
  })

  test('a post-flush watch sees every frame', async () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    const seen: number[] = []
    const scope = effectScope()
    scope.run(() =>
      watch(
        () => ramp.value,
        (value) => seen.push(value),
        { flush: 'post' },
      ),
    )
    await frames(system, 10)
    expect(tracked.updates).toBe(1)
    expect(seen).toHaveLength(10)
    scope.stop()
  })

  test('a computed keeps the ramp only while an effect watches it', async () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    const doubled = computed(() => ramp.value * 2)
    void doubled.value
    await frames(system, 3)
    expect(tracked.updates).toBe(0)
    expect(doubled.value).toBeCloseTo(96, 9)

    const seen: number[] = []
    const scope = effectScope()
    scope.run(() => watchEffect(() => seen.push(doubled.value)))
    await frames(system, 5)
    expect(tracked.updates).toBe(1)
    expect(seen.at(-1)).toBeCloseTo(256, 9)
    scope.stop()
  })

  test('a read from plain code subscribes for two frames, then lapses', async () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    void ramp.value
    await frames(system, 1)
    expect(tracked.updates).toBe(1)
    await frames(system, 1)
    expect(tracked.updates).toBe(0)
    await frames(system, 60)
    expect(ramp.value).toBeCloseTo(992, 9)
  })

  test('two steps with no flush between them resubscribe on the pending read', async () => {
    const { system, tracked, ramp } = setup(() => useRamp(Infinity, 1000, { from: 0 }))
    const seen: number[] = []
    const scope = effectScope()
    scope.run(() => watchEffect(() => seen.push(ramp.value)))
    system.advance(16)
    system.advance(16)
    await nextTick()
    expect(tracked.updates).toBe(1)
    await frames(system, 3)
    expect(seen.at(-1)).toBeCloseTo(80, 9)
    scope.stop()
  })

  test('a reader hidden by v-if drops the ramp and renders the caught-up value when shown', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const tracked = trackRamps(system)
    const shown = ref(true)
    const Reader = defineComponent({
      props: { ramp: { type: Object as PropType<RampRef>, required: true } },
      setup: (props) => () => h('span', String(Math.round(props.ramp.value))),
    })
    const wrapper = mount(
      defineComponent({
        setup() {
          const ramp = useRamp(Infinity, 1000, { from: 0 })
          return () => (shown.value ? h(Reader, { ramp }) : h('i'))
        },
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )
    await frames(system, 3)
    expect(tracked.updates).toBe(1)
    expect(wrapper.text()).toBe('48')

    shown.value = false
    await nextTick()
    await frames(system, 3)
    expect(tracked.updates).toBe(0)

    shown.value = true
    await nextTick()
    expect(wrapper.text()).toBe('96')
    expect(tracked.updates).toBe(1)
  })

  test('a follower subscribes through the source, not the ref', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const tracked = trackRamps(system)
    mount(
      defineComponent({
        setup() {
          useSpring(useRamp(Infinity, 100, { from: 0 }))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )
    expect(tracked.updates).toBe(1)
    for (let i = 0; i < 10; i++) system.advance(16)
    expect(tracked.updates).toBe(1)
    expect(tracked.ramp!.value).toBeCloseTo(16, 9)
  })
})
