import { describe, expect, test } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem } from '../../src/index.ts'
import type { SpringSystem } from '../../src/index.ts'
import { provideSpringSystem, useSpringSystem } from '../../src/vue/system.ts'
import { useSpring, type SpringRef } from '../../src/vue/spring.ts'

function mountTree(parentSetup: () => void, childSetup?: () => void) {
  const Child = defineComponent({
    setup() {
      childSetup?.()
      return {}
    },
    render: () => h('div'),
  })
  const Parent = defineComponent({
    setup() {
      parentSetup()
      return {}
    },
    render: () => h(Child),
  })
  return mount(Parent)
}

describe('useSpringSystem', () => {
  test('creates a system and provides it to descendants', () => {
    let created!: SpringSystem
    let received!: SpringSystem
    mountTree(
      () => {
        created = useSpringSystem()
      },
      () => {
        received = useSpringSystem()
      },
    )

    expect(received).toBe(created)
  })

  test('is idempotent within a single setup', () => {
    let first!: SpringSystem
    let second!: SpringSystem
    mountTree(() => {
      first = useSpringSystem()
      second = useSpringSystem()
    })

    expect(second).toBe(first)
  })

  test('useSpring works in the same component that called useSpringSystem', () => {
    let system!: SpringSystem
    let spring!: SpringRef
    mountTree(() => {
      system = useSpringSystem()
      spring = useSpring(0)
      spring.jumpTo(0)
    })

    expect(spring.value).toBe(0)
    expect(system).toBeDefined()
  })

  test('returns the system an ancestor provided instead of creating one', () => {
    const system = createSpringSystem()
    let received!: SpringSystem
    mountTree(
      () => {
        provideSpringSystem(system)
      },
      () => {
        received = useSpringSystem()
      },
    )

    expect(received).toBe(system)
  })

  test('useSpring works in the same component that called provideSpringSystem', () => {
    const system = createSpringSystem()
    let spring!: SpringRef
    mountTree(() => {
      provideSpringSystem(system)
      spring = useSpring(5)
    })

    expect(spring.value).toBe(5)
  })

  test('options apply only when a system is created', () => {
    let created!: SpringSystem
    let received!: SpringSystem
    mountTree(
      () => {
        created = useSpringSystem({ fps: 30 })
      },
      () => {
        received = useSpringSystem({ fps: 120 })
      },
    )

    expect(created.fps).toBe(30)
    expect(received.fps).toBe(30)
  })

  test('a created system starts on mount and stops on unmount', () => {
    let system!: SpringSystem
    const wrapper = mountTree(() => {
      system = useSpringSystem()
    })

    expect(system.running).toBe(true)

    wrapper.unmount()
    expect(system.running).toBe(false)
  })

  test('an injected system is not lifecycle-managed', () => {
    const system = createSpringSystem()
    let received!: SpringSystem
    const wrapper = mountTree(
      () => {
        provideSpringSystem(system)
      },
      () => {
        received = useSpringSystem()
      },
    )

    expect(received.running).toBe(false)

    wrapper.unmount()
    expect(received.running).toBe(false)
  })

  test('throws outside of setup', () => {
    expect(() => useSpringSystem()).toThrow('useSpringSystem must be called inside setup()')
  })
})
