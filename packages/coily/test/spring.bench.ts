import { bench, describe } from 'vitest'
import { createSpringSystem } from '../src/index.ts'

const FRAME = 1000 / 60

describe('spring creation', () => {
  bench('create 1,000 springs', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 1_000; i++) {
      system.createSpring({ mass: 1, tension: 170, damping: 26 })
    }
  })

  bench('create 10,000 springs', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 10_000; i++) {
      system.createSpring({ mass: 1, tension: 170, damping: 26 })
    }
  })
})

describe('advance simulation', () => {
  bench('advance 100 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 100; i++) {
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      })
    }
    system.advance(FRAME)
  })

  bench('advance 1,000 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 1_000; i++) {
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      })
    }
    system.advance(FRAME)
  })

  bench('advance 10,000 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 10_000; i++) {
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      })
    }
    system.advance(FRAME)
  })
})

describe('advance to rest', () => {
  bench('settle 1 spring to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({
      mass: 1,
      tension: 170,
      damping: 26,
      target: 100,
      value: 0,
    })
    while (!spring.resting) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      }),
    )
    while (springs.some((s) => !s.resting)) {
      system.advance(FRAME)
    }
  })
})

describe('target changes', () => {
  bench('update target on 1,000 springs', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 1_000 }, () =>
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 0,
      }),
    )
    for (const spring of springs) {
      spring.target = 100
    }
  })

  bench('rapid target changes (100 updates, 1 spring)', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({
      mass: 1,
      tension: 170,
      damping: 26,
      target: 0,
      value: 0,
    })
    for (let i = 0; i < 100; i++) {
      spring.target = i * 10
      system.advance(FRAME)
    }
  })
})

describe('springs with listeners', () => {
  bench('advance 1,000 springs with onUpdate listeners', () => {
    const system = createSpringSystem()
    const noop = () => {}
    for (let i = 0; i < 1_000; i++) {
      const spring = system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      })
      spring.onUpdate(noop)
    }
    system.advance(FRAME)
  })
})

describe('mixed operations', () => {
  bench('create, animate, dispose cycle (100 springs)', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({
        mass: 1,
        tension: 170,
        damping: 26,
        target: 100,
        value: 0,
      }),
    )
    for (let i = 0; i < 10; i++) {
      system.advance(FRAME)
    }
    for (const spring of springs) {
      spring.dispose()
    }
  })
})
