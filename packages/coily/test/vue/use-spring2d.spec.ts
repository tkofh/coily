import { describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem } from '../../src/index.ts'
import type { Vector2 } from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useSpring2D, type SpringRef2D } from '../../src/vue/spring2d.ts'
import type { MaybeRefOrGetter } from 'vue'

function mountSpring2D(target: MaybeRefOrGetter<Vector2>) {
  const system = createSpringSystem()
  let spring!: SpringRef2D
  const wrapper = mount(
    defineComponent({
      setup() {
        spring = useSpring2D(target)
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

describe('useSpring2D', () => {
  test('initial value matches target', () => {
    const { spring } = mountSpring2D({ x: 5, y: 10 })

    expect(spring.value).toEqual({ x: 5, y: 10 })
    expect(spring.velocity.value).toEqual({ x: 0, y: 0 })
    expect(spring.isResting.value).toBe(true)
  })

  test('value updates when system advances', async () => {
    const target = ref({ x: 0, y: 0 })
    const { spring, system } = mountSpring2D(target)

    target.value = { x: 100, y: 200 }
    await nextTick()

    system.advance(16)
    expect(spring.value.x).toBeGreaterThan(0)
    expect(spring.value.y).toBeGreaterThan(0)
    expect(spring.isResting.value).toBe(false)
  })

  test('jumpTo sets value immediately', () => {
    const { spring } = mountSpring2D({ x: 0, y: 0 })

    spring.jumpTo({ x: 42, y: 24 })
    expect(spring.value).toEqual({ x: 42, y: 24 })
    expect(spring.isResting.value).toBe(true)
  })

  test('isResting becomes true when spring settles', async () => {
    const target = ref({ x: 0, y: 0 })
    const { spring, system } = mountSpring2D(target)

    target.value = { x: 10, y: 10 }
    await nextTick()
    system.advance(16)
    expect(spring.isResting.value).toBe(false)

    for (let i = 0; i < 500; i++) system.advance(16)
    expect(spring.isResting.value).toBe(true)
  })

  test('a SpringRef2D target links the springs', async () => {
    const system = createSpringSystem()
    const target = ref({ x: 0, y: 0 })
    let leader!: SpringRef2D
    let follower!: SpringRef2D
    mount(
      defineComponent({
        setup() {
          leader = useSpring2D(target)
          follower = useSpring2D(leader)
          return {}
        },
        render: () => h('div'),
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    target.value = { x: 100, y: 50 }
    await nextTick()

    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (leader.isResting.value && follower.isResting.value) break
    }

    expect(follower.value).toEqual({ x: 100, y: 50 })
  })
})
