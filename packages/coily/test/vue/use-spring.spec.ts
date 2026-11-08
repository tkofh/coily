import { describe, expect, test } from 'vitest'
import {
  defineComponent,
  h,
  nextTick,
  reactive,
  ref,
  shallowRef,
  watchEffect,
  watchSyncEffect,
} from 'vue'
import { mount } from '@vue/test-utils'
import {
  type SpringSource,
  createSpringSystem,
  mapSpring,
  targetOf,
  velocityOf,
} from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useSpring, type SpringRef } from '../../src/vue/spring.ts'
import type { MaybeRefOrGetter } from 'vue'

interface SpringDefinitionOptions {
  mass: number
  tension: number
  damping: number
  precision?: number
}

function mountSpring(
  target: MaybeRefOrGetter<number>,
  options?: MaybeRefOrGetter<SpringDefinitionOptions>,
) {
  const system = createSpringSystem()
  let spring!: SpringRef
  const wrapper = mount(
    defineComponent({
      setup() {
        spring = useSpring(target, options)
        return { spring }
      },
      render: () => h('div'),
    }),
    {
      global: {
        provide: { [SpringSystemKey as symbol]: system },
      },
    },
  )
  return { wrapper, spring, system }
}

describe('useSpring', () => {
  test('initial value matches target', () => {
    const { spring } = mountSpring(5)

    expect(spring.value).toBe(5)
    expect(spring.velocity.value).toBe(0)
    expect(spring.isResting.value).toBe(true)
  })

  test('throws without a SpringSystem', () => {
    expect(() => {
      mount(
        defineComponent({
          setup() {
            useSpring(0)
            return {}
          },
          render: () => h('div'),
        }),
      )
    }).toThrow('No SpringSystem found')
  })

  test('value updates when system advances', async () => {
    const target = ref(0)
    const { spring, system } = mountSpring(target)

    expect(spring.value).toBe(0)

    target.value = 100
    await nextTick()

    system.advance(16)
    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
    expect(spring.isResting.value).toBe(false)
  })

  test('reactive options update spring config', async () => {
    const target = ref(0)
    const options = ref({ mass: 1, tension: 100, damping: 10 })
    const { spring, system } = mountSpring(target, options)

    target.value = 100
    await nextTick()
    system.advance(16)
    const valueDefault = spring.value

    target.value = 0
    await nextTick()
    for (let i = 0; i < 500; i++) system.advance(16)

    options.value = { mass: 1, tension: 1000, damping: 10 }
    target.value = 100
    await nextTick()
    system.advance(16)
    const valueStiff = spring.value

    expect(valueStiff).toBeGreaterThan(valueDefault)
  })

  test('jumpTo sets value immediately', () => {
    const { spring } = mountSpring(0)

    spring.jumpTo(42)
    expect(spring.value).toBe(42)
    expect(spring.velocity.value).toBe(0)
  })

  test('velocity is reactive during animation', async () => {
    const target = ref(0)
    const { spring, system } = mountSpring(target)

    expect(spring.velocity.value).toBe(0)

    target.value = 100
    await nextTick()
    system.advance(16)

    expect(spring.velocity.value).not.toBe(0)
  })

  test('isResting becomes true when spring settles', async () => {
    const target = ref(0)
    const { spring, system } = mountSpring(target)

    target.value = 10
    await nextTick()
    system.advance(16)
    expect(spring.isResting.value).toBe(false)

    for (let i = 0; i < 500; i++) system.advance(16)
    expect(spring.isResting.value).toBe(true)
  })

  test('getter target works', () => {
    const { spring } = mountSpring(() => 25)
    expect(spring.value).toBe(25)
  })

  test('writing to the ref displaces the spring', async () => {
    const target = ref(0)
    const { spring, system } = mountSpring(target)

    spring.value = 50
    expect(spring.value).toBe(50)
    expect(spring.isResting.value).toBe(false)

    for (let i = 0; i < 500; i++) system.advance(16)
    expect(spring.value).toBe(0)
  })

  test('several independent scalar springs compose via map', () => {
    const system = createSpringSystem()
    let springs!: readonly SpringRef[]
    mount(
      defineComponent({
        setup() {
          springs = [0, () => 10, ref(20)].map((target) => useSpring(target))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    expect(springs).toHaveLength(3)
    expect(springs.map((s) => s.value)).toEqual([0, 10, 20])
  })

  test('a SpringRef target links the springs', async () => {
    const system = createSpringSystem()
    const target = ref(0)
    let leader!: SpringRef
    let follower!: SpringRef
    mount(
      defineComponent({
        setup() {
          leader = useSpring(target)
          follower = useSpring(leader)
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    target.value = 100
    await nextTick()

    for (let i = 0; i < 10; i++) system.advance(16)
    expect(follower.value).toBeGreaterThan(0)
    expect(follower.value).toBeLessThan(100)

    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (leader.isResting.value && follower.isResting.value) break
    }
    expect(follower.value).toBe(100)
  })

  test('a mapped SpringRef is a valid target', async () => {
    const system = createSpringSystem()
    const target = ref(0)
    let leader!: SpringRef
    let follower!: SpringRef
    mount(
      defineComponent({
        setup() {
          leader = useSpring(target)
          follower = useSpring(mapSpring(leader, (value) => value + 10))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    expect(follower.value).toBe(10)

    target.value = 100
    await nextTick()
    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (leader.isResting.value && follower.isResting.value) break
    }
    expect(follower.value).toBe(110)
  })

  test('spring refs derive target and velocity sources like their springs', async () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const target = ref(0)
    let body!: SpringRef
    let remaining!: SpringRef
    let speed!: SpringRef
    mount(
      defineComponent({
        setup() {
          body = useSpring(target)
          remaining = useSpring(
            mapSpring({ value: body, target: targetOf(body) }, (v) => v.target - v.value),
          )
          speed = useSpring(velocityOf(body))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    target.value = 100
    await nextTick()
    system.advance(16)
    expect(body.value).toBeGreaterThan(0)
    expect(remaining.velocity.value).not.toBe(0)
    expect(speed.velocity.value).not.toBe(0)

    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (body.isResting.value && remaining.isResting.value && speed.isResting.value) break
    }
    expect(remaining.value).toBe(0)
    expect(speed.value).toBe(0)
  })

  test('spring refs compose as mapSpring leaves', async () => {
    const system = createSpringSystem()
    const xTarget = ref(0)
    const yTarget = ref(0)
    let x!: SpringRef
    let y!: SpringRef
    let sum!: SpringRef
    mount(
      defineComponent({
        setup() {
          x = useSpring(xTarget)
          y = useSpring(yTarget)
          sum = useSpring(mapSpring({ x, y }, (values) => values.x + values.y))
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    expect(sum.value).toBe(0)

    xTarget.value = 30
    yTarget.value = 40
    await nextTick()
    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (x.isResting.value && y.isResting.value && sum.isResting.value) break
    }
    expect(sum.value).toBe(70)
  })

  test('a getter target switches leaders without tracking their motion', async () => {
    const system = createSpringSystem()
    const targetA = ref(10)
    const useSecond = ref(false)
    let gets = 0
    let a!: SpringRef
    let b!: SpringRef
    let follower!: SpringRef
    mount(
      defineComponent({
        setup() {
          a = useSpring(targetA)
          b = useSpring(20)
          follower = useSpring(() => {
            gets++
            return useSecond.value ? b : a
          })
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    expect(follower.value).toBe(10)
    const getsAfterSetup = gets

    // The first leader animating must not re-run the getter: following
    // reads through the source slot, not the ref's tracked getter.
    targetA.value = 100
    await nextTick()
    for (let i = 0; i < 20; i++) system.advance(16)
    expect(gets).toBe(getsAfterSetup)
    expect(follower.value).toBeGreaterThan(10)

    // Switching the getter's own dependency re-follows immediately.
    useSecond.value = true
    expect(gets).toBe(getsAfterSetup + 1)
    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (b.isResting.value && follower.isResting.value) break
    }
    expect(follower.value).toBe(20)
  })

  test('a synchronous leader write inside an effect stays untracked', () => {
    const system = createSpringSystem()
    const trigger = ref(0)
    let runs = 0
    let leader!: SpringRef
    mount(
      defineComponent({
        setup() {
          leader = useSpring(0)
          // The follower subscribes through the leader ref's source slot.
          // Its retargets read the backing spring, not the tracked getter.
          useSpring(mapSpring(leader, (value) => value))
          watchSyncEffect(() => {
            runs++
            void trigger.value
            // Displacing emits update synchronously: the follower
            // retargets inside this very effect run.
            leader.value = 50
          })
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    expect(runs).toBe(1)

    // The leader springs back and updates every frame. A phantom
    // dependency would re-run the effect, and displace the leader again,
    // on each frame.
    for (let i = 0; i < 60; i++) system.advance(16)
    expect(runs).toBe(1)

    // The effect's real dependency still triggers it.
    trigger.value++
    expect(runs).toBe(2)
  })

  test('settled resolves when the spring settles', async () => {
    const target = ref(0)
    const { spring, system } = mountSpring(target)

    target.value = 100
    await nextTick()

    let resolved = false
    spring.settled.then(() => {
      resolved = true
    })

    for (let i = 0; i < 500; i++) system.advance(16)
    await new Promise((resolve) => setTimeout(resolve))

    expect(resolved).toBe(true)
    expect(spring.value).toBe(100)
  })

  test('timeRemaining effects see a retarget from rest before the next frame', async () => {
    const system = createSpringSystem()
    const target = ref(0)
    const seen: number[] = []
    let spring!: SpringRef
    mount(
      defineComponent({
        setup() {
          spring = useSpring(target)
          watchEffect(() => {
            seen.push(spring.timeRemaining.value)
          })
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    target.value = 100
    await nextTick()

    expect(spring.timeRemaining.value).toBeGreaterThan(0)
    expect(seen.at(-1)).toBe(spring.timeRemaining.value)

    for (let i = 0; i < 500 && !spring.isResting.value; i++) system.advance(16)
    await nextTick()
    expect(seen.at(-1)).toBe(0)
  })

  test('disposing the component disposes the spring', async () => {
    const target = ref(0)
    const { wrapper, spring, system } = mountSpring(target)

    target.value = 100
    await nextTick()
    system.advance(16)

    wrapper.unmount()

    // The unmount disposed the spring, so advancing must not move it.
    const valueAtUnmount = spring.value
    system.advance(16)
    expect(spring.value).toBe(valueAtUnmount)
  })
})

describe('useSpring: core sources behind Vue proxies', () => {
  function mountWith(system: ReturnType<typeof createSpringSystem>, setup: () => SpringRef) {
    let follower!: SpringRef
    mount(
      defineComponent({
        setup() {
          follower = setup()
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )
    return follower
  }

  const containers = {
    ref: <T>(value: T) => {
      const box = ref(value)
      return () => box.value
    },
    shallowRef: <T>(value: T) => {
      const box = shallowRef(value)
      return () => box.value
    },
    'reactive getter': <T>(value: T) => {
      const state = reactive({ leader: value })
      return () => state.leader
    },
  }

  for (const [kind, contain] of Object.entries(containers)) {
    test(`follows a core spring in a ${kind}`, () => {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const leader = system.createSpring(5)
      const read = contain(leader)
      const follower = mountWith(system, () => useSpring(read as () => SpringSource))
      expect(follower.value).toBe(5)

      leader.target = 50
      for (let i = 0; i < 2000 && !(leader.isResting && follower.isResting.value); i++) {
        system.advance(16)
      }
      expect(follower.value).toBe(50)
    })

    test(`follows a core ramp in a ${kind}`, () => {
      const system = createSpringSystem({ reducedMotion: 'never' })
      const ramp = system.createRamp(0, { rate: 1000, target: 40 })
      const follower = mountWith(system, () => useSpring(contain(ramp) as never))
      for (let i = 0; i < 2000 && !(ramp.isResting && follower.isResting.value); i++) {
        system.advance(16)
      }
      expect(follower.value).toBe(40)
    })
  }

  test('ref() holding a core spring follows instead of retargeting per frame', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const raw = system.createSpring(0)
    const leader = ref(raw)
    let reads = 0
    const follower = mountWith(system, () =>
      useSpring(() => {
        reads++
        return leader.value
      }),
    )
    const before = reads
    // Core methods read private fields, so writes go through the raw spring.
    raw.target = 100
    for (let i = 0; i < 2000 && !(raw.isResting && follower.isResting.value); i++) {
      system.advance(16)
    }
    expect(reads).toBe(before)
    expect(follower.value).toBe(100)
  })

  test('a getter switches between proxied core leaders', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const state = reactive({ a: system.createSpring(10), b: system.createSpring(20) })
    const second = ref(false)
    const follower = mountWith(system, () => useSpring(() => (second.value ? state.b : state.a)))
    expect(follower.value).toBe(10)
    second.value = true
    for (let i = 0; i < 2000 && !follower.isResting.value; i++) system.advance(16)
    expect(follower.value).toBe(20)
  })

  test('a ref of a core composite is followed channel by channel', () => {
    const system = createSpringSystem({ reducedMotion: 'never' })
    const raw = system.createSpring({ x: 1, y: 2 })
    const leader = ref(raw)
    let follower!: { value: { x: number; y: number }; isResting: { value: boolean } }
    mount(
      defineComponent({
        setup() {
          // `ref` unwraps the composite's type into a plain object type.
          follower = useSpring((() => leader.value) as never) as never
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )
    raw.target = { x: 10, y: 20 }
    for (let i = 0; i < 2000 && !(raw.isResting && follower.isResting.value); i++) {
      system.advance(16)
    }
    expect(follower.value).toEqual({ x: 10, y: 20 })
  })
})
