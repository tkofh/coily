import { describe, expect, test } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createSpringSystem, defineSpring } from '../../src/index.ts'
import { SpringSystemKey } from '../../src/vue/system.ts'
import { useSpring } from '../../src/vue/spring.ts'
import { useSpringPool, type SpringPool } from '../../src/vue/pool.ts'

const stiff = defineSpring({ tension: 1000, dampingRatio: 1 })
const gentle = defineSpring({ tension: 10, dampingRatio: 1 })

function mountWith<R>(setup: () => R) {
  const system = createSpringSystem()
  let result!: R
  const wrapper = mount(
    defineComponent({
      setup() {
        result = setup()
        return {}
      },
      render: () => h('div'),
    }),
    { global: { provide: { [SpringSystemKey as symbol]: system } } },
  )
  return { wrapper, system, result }
}

function mountObject<R>(setup: () => R) {
  const { wrapper, system, result } = mountWith(setup)
  return { wrapper, system, spring: result }
}

describe('useSpring: object shapes', () => {
  test('initial value mirrors the shape', () => {
    const { spring } = mountObject(() => useSpring({ position: { x: 10, y: 20 }, opacity: 1 }))

    expect(spring.value).toEqual({ position: { x: 10, y: 20 }, opacity: 1 })
    expect(spring.isResting.value).toBe(true)
  })

  test('supports top-level array shapes', () => {
    const { spring } = mountObject(() => useSpring([0, 10]))

    expect(spring.value).toEqual([0, 10])
    expect(Array.isArray(spring.value)).toBe(true)
  })

  test('a ref target retargets the channels it names', async () => {
    const target = ref({ x: 0, y: 0 })
    const { spring, system } = mountObject(() => useSpring(target))

    target.value = { x: 100, y: 50 }
    await nextTick()

    system.advance(16)
    expect(spring.value.x).toBeGreaterThan(0)
    expect(spring.value.x).toBeLessThan(100)
    expect(spring.value.y).toBeGreaterThan(0)
    expect(spring.isResting.value).toBe(false)
  })

  test('a reactive target retargets on deep mutation', () => {
    const target = reactive({ position: { x: 0, y: 0 }, opacity: 0 })
    const { spring, system } = mountObject(() => useSpring(target))

    // watchSyncEffect tracks the channel reads inside the target setter,
    // so a nested write retargets synchronously.
    target.position.x = 100

    system.advance(16)
    expect(spring.value.position.x).toBeGreaterThan(0)
    expect(spring.value.position.y).toBe(0)
    expect(spring.value.opacity).toBe(0)
  })

  test('getter targets work', () => {
    const { spring } = mountObject(() => useSpring(() => ({ x: 25, y: 50 })))

    expect(spring.value).toEqual({ x: 25, y: 50 })
  })

  test('writing a partial to the ref displaces only those channels', () => {
    const { spring, system } = mountObject(() => useSpring({ x: 0, y: 0 }))

    spring.value = { x: 50 }

    expect(spring.value.x).toBe(50)
    expect(spring.value.y).toBe(0)
    expect(spring.isResting.value).toBe(false)

    for (let i = 0; i < 500; i++) system.advance(16)
    expect(spring.value.x).toBe(0)
  })

  test('jumpTo snaps the named channels', () => {
    const { spring } = mountObject(() => useSpring({ x: 0, y: 0 }))

    spring.jumpTo({ y: 42 })

    expect(spring.value).toEqual({ x: 0, y: 42 })
    expect(spring.isResting.value).toBe(true)
  })

  test('velocity is reactive during animation', async () => {
    const target = ref({ x: 0 })
    const { spring, system } = mountObject(() => useSpring(target))

    target.value = { x: 100 }
    await nextTick()
    system.advance(16)

    expect(spring.velocity.value.x).not.toBe(0)
  })

  test('reactive options update the config', async () => {
    const target = ref({ x: 0 })
    const options = ref(defineSpring({ mass: 1, tension: 100, damping: 10 }))
    const { spring, system } = mountObject(() => useSpring(target, options))

    target.value = { x: 100 }
    await nextTick()
    system.advance(16)
    const valueDefault = spring.value.x

    target.value = { x: 0 }
    await nextTick()
    for (let i = 0; i < 500; i++) system.advance(16)

    options.value = defineSpring({ mass: 1, tension: 1000, damping: 10 })
    target.value = { x: 100 }
    await nextTick()
    system.advance(16)

    expect(spring.value.x).toBeGreaterThan(valueDefault)
  })

  test('per-channel config shapes apply', () => {
    const target = ref({ fast: 0, slow: 0 })
    const { spring, system } = mountObject(() => useSpring(target, { fast: stiff, slow: gentle }))

    target.value = { fast: 100, slow: 100 }

    system.advance(100)
    expect(spring.value.fast).toBeGreaterThan(spring.value.slow)
  })

  test('a SpringObjectRef target links the springs channel-wise', async () => {
    const target = ref({ x: 0, y: 0 })
    const { system, result } = mountWith(() => {
      const leader = useSpring(target)
      const follower = useSpring(leader)
      return { leader, follower }
    })
    const { leader, follower } = result

    target.value = { x: 100, y: -50 }
    await nextTick()

    for (let i = 0; i < 10; i++) system.advance(16)
    expect(follower.value.x).toBeGreaterThan(0)
    expect(follower.value.x).toBeLessThan(100)

    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (leader.isResting.value && follower.isResting.value) break
    }
    expect(follower.value).toEqual({ x: 100, y: -50 })
  })

  test('settled resolves when every channel rests', async () => {
    const target = ref({ x: 0, y: 0 })
    const { spring, system } = mountObject(() => useSpring(target))

    target.value = { x: 100, y: 50 }
    await nextTick()

    let resolved = false
    spring.settled.then(() => {
      resolved = true
    })

    for (let i = 0; i < 500; i++) system.advance(16)
    await new Promise((resolve) => setTimeout(resolve))

    expect(resolved).toBe(true)
    expect(spring.value).toEqual({ x: 100, y: 50 })
  })

  test('disposing the component disposes the spring', async () => {
    const target = ref({ x: 0 })
    const { wrapper, spring, system } = mountObject(() => useSpring(target))

    target.value = { x: 100 }
    await nextTick()
    system.advance(16)

    wrapper.unmount()

    const valueAtUnmount = spring.value.x
    system.advance(16)
    expect(spring.value.x).toBe(valueAtUnmount)
  })
})

describe('useSpring shape dispatch', () => {
  test('a record shape creates an object spring', () => {
    const { result: spring } = mountWith(() => useSpring({ position: { x: 5, y: 10 } }))

    expect(spring.value).toEqual({ position: { x: 5, y: 10 } })
  })

  test('a ref of a record shape creates an object spring', async () => {
    const target = ref({ x: 0 })
    const { system, result: spring } = mountWith(() => useSpring(target))

    target.value = { x: 100 }
    await nextTick()

    system.advance(16)
    expect(spring.value.x).toBeGreaterThan(0)
  })

  test('numbers still create scalar springs', () => {
    const { result } = mountWith(() => ({
      scalar: useSpring(5),
      viaRef: useSpring(ref(7)),
      viaGetter: useSpring(() => 9),
    }))

    expect(result.scalar.value).toBe(5)
    expect(result.viaRef.value).toBe(7)
    expect(result.viaGetter.value).toBe(9)
  })

  test('a ref of an array shape is one spring over that shape', async () => {
    const target = ref([0, 10])
    const { system, result: spring } = mountWith(() => useSpring(target))

    expect(spring.value).toEqual([0, 10])
    expect(Array.isArray(spring.value)).toBe(true)

    target.value = [100, 10]
    await nextTick()

    system.advance(16)
    expect(spring.value[0]).toBeGreaterThan(0)
    expect(spring.value[1]).toBe(10)
  })

  test('an object ref target links through useSpring', async () => {
    const target = ref({ x: 0 })
    const { system, result } = mountWith(() => {
      const leader = useSpring(target)
      const follower = useSpring(leader)
      return { leader, follower }
    })

    target.value = { x: 100 }
    await nextTick()

    for (let i = 0; i < 1000; i++) {
      system.advance(16)
      if (result.leader.isResting.value && result.follower.isResting.value) break
    }
    expect(result.follower.value.x).toBe(100)
  })
})

describe('useSpringPool createSpring', () => {
  test('pool spring objects dispose with the scope', () => {
    let pool!: SpringPool
    const {
      wrapper,
      system,
      result: spring,
    } = mountWith(() => {
      pool = useSpringPool()
      return pool.createSpring({ x: 0, y: 0 })
    })

    spring.target = { x: 100 }
    system.advance(16)
    expect(spring.value.x).toBeGreaterThan(0)

    wrapper.unmount()

    const valueAtUnmount = spring.value.x
    system.advance(16)
    expect(spring.value.x).toBe(valueAtUnmount)
  })
})
