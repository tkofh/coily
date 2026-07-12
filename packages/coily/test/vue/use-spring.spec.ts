import { describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem } from '../../src/index.ts'
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

    // Move with default tension
    target.value = 100
    await nextTick()
    system.advance(16)
    const valueDefault = spring.value

    // Reset
    target.value = 0
    await nextTick()
    for (let i = 0; i < 500; i++) system.advance(16)

    // Move with very stiff spring
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

  test('disposing the component disposes the spring', async () => {
    const target = ref(0)
    const { wrapper, spring, system } = mountSpring(target)

    target.value = 100
    await nextTick()
    system.advance(16)

    wrapper.unmount()

    // A disposed spring's motion is removed — advancing must not move it
    const valueAtUnmount = spring.value
    system.advance(16)
    expect(spring.value).toBe(valueAtUnmount)
  })
})
