import { describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem, defineSpring } from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useSpringPool, type SpringPool } from '../../src/vue/pool.ts'

const config = defineSpring({ mass: 1, tension: 170, damping: 26 })

function mountPool() {
  const system = createSpringSystem()
  let pool!: SpringPool
  const wrapper = mount(
    defineComponent({
      setup() {
        pool = useSpringPool()
        return {}
      },
      render: () => h('div'),
    }),
    {
      global: {
        provide: { [SpringSystemKey as symbol]: system },
      },
    },
  )
  return { wrapper, pool, system }
}

describe('useSpringPool', () => {
  test('creates springs on the provided system', () => {
    const { pool, system } = mountPool()

    const spring = pool.createSpring({ target: 100, value: 0 }, config)
    system.advance(1000 / 60)

    expect(spring.value).toBeGreaterThan(0)
    expect(spring.value).toBeLessThan(100)
  })

  test('disposes live springs when the component unmounts', () => {
    const { wrapper, pool, system } = mountPool()

    const spring = pool.createSpring({ target: 100, value: 0 }, config)
    const spring2d = pool.createSpring2D({ target: { x: 100, y: 100 }, value: { x: 0, y: 0 } })
    system.advance(1000 / 60)

    wrapper.unmount()

    const value = spring.value
    const value2d = { ...spring2d.value }
    system.advance(1000 / 60)

    expect(spring.value).toBe(value)
    expect(spring2d.value).toEqual(value2d)
  })

  test('manually disposed springs unregister from the pool', () => {
    const { wrapper, pool } = mountPool()

    const early = pool.createSpring({ target: 100, value: 0 }, config)
    const late = pool.createSpring({ target: 100, value: 0 }, config)

    const earlyDispose = vi.fn()
    const lateDispose = vi.fn()
    early.onDispose(earlyDispose)
    late.onDispose(lateDispose)

    early.dispose()
    expect(earlyDispose).toHaveBeenCalledOnce()

    expect(() => wrapper.unmount()).not.toThrow()
    expect(earlyDispose).toHaveBeenCalledOnce()
    expect(lateDispose).toHaveBeenCalledOnce()
  })

  test('throws without a provided system', () => {
    expect(() => {
      mount(
        defineComponent({
          setup() {
            useSpringPool()
            return {}
          },
          render: () => h('div'),
        }),
      )
    }).toThrow('No SpringSystem found')
  })
})
