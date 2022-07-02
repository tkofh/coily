import { describe, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import SpringSystem from './components/SpringSystem.vue'
import Spring from './components/Spring.vue'

describe('useSpring', () => {
  test('it creates a spring', ({ expect }) => {
    const wrapper = mount(defineComponent({ render: () => h(SpringSystem, [h(Spring)]) }))

    const system = wrapper.getComponent(SpringSystem).vm.system
    const spring = wrapper.getComponent(Spring).vm.spring

    expect(system).toBeDefined()
    expect(spring).toBeDefined()

    expect(spring.current.value).toBe(spring.target.value)

    const previousValue = spring.current.value

    spring.target.value += 10

    system.simulate(10)

    expect(spring.current.value).toBeGreaterThan(previousValue)
    expect(spring.current.value).toBeLessThan(spring.target.value)
  })
})
