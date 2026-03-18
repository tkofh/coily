import { describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem } from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useSpring } from '../../src/vue/spring.ts'
import type { MaybeRefOrGetter } from 'vue'

interface SpringOptions {
  mass: number
  tension: number
  damping: number
  precision?: number
}

function mountSpring(target: MaybeRefOrGetter<number>, options?: MaybeRefOrGetter<SpringOptions>) {
  const system = createSpringSystem()
  const wrapper = mount(
    defineComponent({
      setup() {
        const { value, velocity, isResting, jumpTo } = useSpring(target, options)
        return { value, velocity, isResting, jumpTo }
      },
      render: () => h('div'),
    }),
    {
      global: {
        provide: { [SpringSystemKey as symbol]: system },
      },
    },
  )
  return { wrapper, system }
}

describe('useSpring', () => {
  test('initial value matches target', () => {
    const { wrapper } = mountSpring(5)

    expect(wrapper.vm.value).toBe(5)
    expect(wrapper.vm.velocity).toBe(0)
    expect(wrapper.vm.isResting).toBe(true)
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
    const { wrapper, system } = mountSpring(target)

    expect(wrapper.vm.value).toBe(0)

    target.value = 100
    await nextTick()

    system.advance(16)
    expect(wrapper.vm.value).toBeGreaterThan(0)
    expect(wrapper.vm.value).toBeLessThan(100)
    expect(wrapper.vm.isResting).toBe(false)
  })

  test('reactive options update spring config', async () => {
    const target = ref(0)
    const options = ref({ mass: 1, tension: 100, damping: 10 })
    const { wrapper, system } = mountSpring(target, options)

    // Move with default tension
    target.value = 100
    await nextTick()
    system.advance(16)
    const valueDefault = wrapper.vm.value

    // Reset
    target.value = 0
    await nextTick()
    for (let i = 0; i < 500; i++) system.advance(16)

    // Move with very stiff spring
    options.value = { mass: 1, tension: 1000, damping: 10 }
    target.value = 100
    await nextTick()
    system.advance(16)
    const valueStiff = wrapper.vm.value

    expect(valueStiff).toBeGreaterThan(valueDefault)
  })

  test('jumpTo sets value immediately', () => {
    const { wrapper } = mountSpring(0)

    wrapper.vm.jumpTo(42)
    expect(wrapper.vm.value).toBe(42)
    expect(wrapper.vm.velocity).toBe(0)
  })

  test('velocity is reactive during animation', async () => {
    const target = ref(0)
    const { wrapper, system } = mountSpring(target)

    expect(wrapper.vm.velocity).toBe(0)

    target.value = 100
    await nextTick()
    system.advance(16)

    expect(wrapper.vm.velocity).not.toBe(0)
  })

  test('isResting becomes true when spring settles', async () => {
    const target = ref(0)
    const { wrapper, system } = mountSpring(target)

    target.value = 10
    await nextTick()
    system.advance(16)
    expect(wrapper.vm.isResting).toBe(false)

    for (let i = 0; i < 500; i++) system.advance(16)
    expect(wrapper.vm.isResting).toBe(true)
  })

  test('getter target works', () => {
    const { wrapper } = mountSpring(() => 25)
    expect(wrapper.vm.value).toBe(25)
  })
})
