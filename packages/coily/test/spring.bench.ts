import { bench, describe } from 'vitest'
import { createSpringSystem, defineSpring } from '../src/index.ts'

const FRAME = 1000 / 60

const defaultConfig = defineSpring({ mass: 1, tension: 170, damping: 26 })

describe('spring creation', () => {
  bench('create 1,000 springs', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 1_000; i++) {
      system.createSpring(0, defaultConfig)
    }
  })

  bench('create 10,000 springs', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 10_000; i++) {
      system.createSpring(0, defaultConfig)
    }
  })
})

describe('advance simulation', () => {
  bench('advance 100 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 100; i++) {
      system.createSpring({ target: 100, value: 0 }, defaultConfig)
    }
    system.advance(FRAME)
  })

  bench('advance 1,000 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 1_000; i++) {
      system.createSpring({ target: 100, value: 0 }, defaultConfig)
    }
    system.advance(FRAME)
  })

  bench('advance 10,000 active springs (1 frame)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 10_000; i++) {
      system.createSpring({ target: 100, value: 0 }, defaultConfig)
    }
    system.advance(FRAME)
  })
})

describe('advance to rest', () => {
  bench('settle 1 spring to rest', () => {
    const system = createSpringSystem()
    const spring = system.createSpring({ target: 100, value: 0 }, defaultConfig)
    while (!spring.resting) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({ target: 100, value: 0 }, defaultConfig),
    )
    while (springs.some((s) => !s.resting)) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest (with onUpdate)', () => {
    const system = createSpringSystem()
    let sum = 0
    const springs = Array.from({ length: 100 }, () => {
      const spring = system.createSpring({ target: 100, value: 0 }, defaultConfig)
      spring.onUpdate(() => {
        sum += spring.value
      })
      return spring
    })
    while (springs.some((s) => !s.resting)) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest (noop onUpdate)', () => {
    const system = createSpringSystem()
    const noop = () => {}
    const springs = Array.from({ length: 100 }, () => {
      const spring = system.createSpring({ target: 100, value: 0 }, defaultConfig)
      spring.onUpdate(noop)
      return spring
    })
    while (springs.some((s) => !s.resting)) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest (no listeners)', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({ target: 100, value: 0 }, defaultConfig),
    )
    while (springs.some((s) => !s.resting)) {
      system.advance(FRAME)
    }
    // read final values after settling
    for (const spring of springs) {
      void spring.value
    }
  })
})

describe('target changes', () => {
  bench('update target on 1,000 springs', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 1_000 }, () => system.createSpring(0, defaultConfig))
    for (const spring of springs) {
      spring.target = 100
    }
  })

  bench('rapid target changes (100 updates, 1 spring)', () => {
    const system = createSpringSystem()
    const spring = system.createSpring(0, defaultConfig)
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
      const spring = system.createSpring({ target: 100, value: 0 }, defaultConfig)
      spring.onUpdate(noop)
    }
    system.advance(FRAME)
  })
})

describe('mixed operations', () => {
  bench('create, animate, dispose cycle (100 springs)', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({ target: 100, value: 0 }, defaultConfig),
    )
    for (let i = 0; i < 10; i++) {
      system.advance(FRAME)
    }
    for (const spring of springs) {
      spring.dispose()
    }
  })
})
