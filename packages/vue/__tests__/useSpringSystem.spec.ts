import { describe, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import SpringSystem from './components/SpringSystem.vue'
import ExposeSpringSystem from './components/ExposeSpringSystem.vue'

describe('useSpringSystem', () => {
  test('it provides a spring system', ({ expect }) => {
    const wrapper = mount(
      defineComponent({ render: () => h(SpringSystem, [h(ExposeSpringSystem)]) })
    )

    const system = wrapper.getComponent(ExposeSpringSystem).vm.system
    expect(system).toBeDefined()
    expect(system).toHaveProperty('createSpring')
    expect(system).toHaveProperty('cleanup')
    expect(system).toHaveProperty('simulate')
  })
})
