import { describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem, defineSpring } from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { SpringValue, type SpringValueSlotScope } from '../../src/vue/component.ts'

const stiff = defineSpring({ tension: 1000, dampingRatio: 1 })

function mountValue(props: { target: number; config?: SpringValueConfig }) {
  const system = createSpringSystem()
  let scope!: SpringValueSlotScope
  const wrapper = mount(SpringValue, {
    props,
    slots: {
      default: (slotScope: SpringValueSlotScope) => {
        scope = slotScope
        return h('div', String(slotScope.value))
      },
    },
    global: { provide: { [SpringSystemKey as symbol]: system } },
  })
  return { wrapper, system, scope: () => scope }
}

type SpringValueConfig = typeof stiff | { mass: number; tension: number; damping: number }

describe('SpringValue', () => {
  test('renders the initial value through its default slot', () => {
    const { wrapper, scope } = mountValue({ target: 5 })

    expect(scope().value).toBe(5)
    expect(scope().velocity).toBe(0)
    expect(scope().isResting).toBe(true)
    expect(wrapper.text()).toBe('5')
  })

  test('throws without a provided SpringSystem', () => {
    expect(() => {
      mount(SpringValue, {
        props: { target: 0 },
        slots: { default: () => h('div') },
      })
    }).toThrow('No SpringSystem found')
  })

  test('animates toward a changed target prop', async () => {
    const { wrapper, system, scope } = mountValue({ target: 0 })

    await wrapper.setProps({ target: 100 })
    system.advance(16)
    await nextTick()

    expect(scope().value).toBeGreaterThan(0)
    expect(scope().value).toBeLessThan(100)
    expect(scope().isResting).toBe(false)
  })

  test('a stiffer config prop reaches further in one step', async () => {
    const soft = mountValue({ target: 0 })
    const hard = mountValue({ target: 0, config: stiff })

    await soft.wrapper.setProps({ target: 100 })
    await hard.wrapper.setProps({ target: 100 })
    soft.system.advance(16)
    hard.system.advance(16)
    await nextTick()

    expect(hard.scope().value).toBeGreaterThan(soft.scope().value)
  })

  test('the slot jumpTo snaps the value with no animation', async () => {
    const { scope } = mountValue({ target: 0 })

    scope().jumpTo(42)
    await nextTick()

    expect(scope().value).toBe(42)
    expect(scope().isResting).toBe(true)
  })

  test('settles at the target and reports rest through the slot', async () => {
    const { wrapper, system, scope } = mountValue({ target: 0 })

    await wrapper.setProps({ target: 100 })
    for (let i = 0; i < 500; i++) system.advance(16)
    await nextTick()

    expect(scope().value).toBe(100)
    expect(scope().isResting).toBe(true)
    expect(scope().timeRemaining).toBe(0)
  })

  test('exposes the spring surface for template refs', () => {
    const system = createSpringSystem()
    let api: SpringValueExposed | null = null
    mount(
      defineComponent({
        setup() {
          return () =>
            h(
              SpringValue,
              {
                target: 7,
                ref: (el) => {
                  api = el as unknown as SpringValueExposed
                },
              },
              { default: () => h('div') },
            )
        },
      }),
      { global: { provide: { [SpringSystemKey as symbol]: system } } },
    )

    // The exposeProxy unwraps the attached refs, so reads are plain values.
    expect(api).not.toBeNull()
    expect(api!.value).toBe(7)
    expect(api!.velocity).toBe(0)
    expect(api!.isResting).toBe(true)
    expect(api!.timeRemaining).toBe(0)
    expect(typeof api!.jumpTo).toBe('function')
  })

  test('disposes the spring when unmounted', async () => {
    const { wrapper, system, scope } = mountValue({ target: 0 })

    await wrapper.setProps({ target: 100 })
    system.advance(16)
    await nextTick()
    const valueAtUnmount = scope().value
    expect(valueAtUnmount).toBeGreaterThan(0)

    wrapper.unmount()
    system.advance(16)

    // No further render occurs; the last-seen slot value is frozen.
    expect(scope().value).toBe(valueAtUnmount)
  })
})

interface SpringValueExposed {
  value: number
  velocity: number
  isResting: boolean
  timeRemaining: number
  jumpTo: (value: number) => void
}
