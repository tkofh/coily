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
    while (!spring.isResting) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({ target: 100, value: 0 }, defaultConfig),
    )
    while (springs.some((s) => !s.isResting)) {
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
    while (springs.some((s) => !s.isResting)) {
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
    while (springs.some((s) => !s.isResting)) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 springs to rest (no listeners)', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () =>
      system.createSpring({ target: 100, value: 0 }, defaultConfig),
    )
    while (springs.some((s) => !s.isResting)) {
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

describe('linked spring chains', () => {
  function createChain(system: ReturnType<typeof createSpringSystem>, length: number) {
    const head = system.createSpring(0, defaultConfig)
    const springs = [head]
    let prev = head
    for (let i = 1; i < length; i++) {
      prev = system.createSpring({ target: prev })
      springs.push(prev)
    }
    return springs
  }

  bench('64-spring chain: 60 frames of continuous motion', () => {
    const system = createSpringSystem()
    const springs = createChain(system, 64)
    springs[0]!.target = 100
    for (let i = 0; i < 60; i++) {
      system.advance(FRAME)
    }
  })

  bench('64-spring chain with onUpdate listeners: 60 frames', () => {
    const system = createSpringSystem()
    const springs = createChain(system, 64)
    let sum = 0
    for (const spring of springs) {
      spring.onUpdate(() => {
        sum += spring.value
      })
    }
    springs[0]!.target = 100
    for (let i = 0; i < 60; i++) {
      system.advance(FRAME)
    }
  })

  bench('settle 256-spring chain to rest', () => {
    const system = createSpringSystem()
    const springs = createChain(system, 256)
    springs[0]!.target = 100
    while (springs.some((s) => !s.isResting)) {
      system.advance(FRAME)
    }
  })
})

describe('spring objects', () => {
  // Four channels per object — comparable to four scalar springs.
  const shape = { position: { x: 0, y: 0 }, scale: 1, opacity: 1 }
  const fullTarget = { position: { x: 100, y: 100 }, scale: 2, opacity: 0 }

  bench('create 1,000 spring objects (4 channels)', () => {
    const system = createSpringSystem()
    for (let i = 0; i < 1_000; i++) {
      system.createSpringObject(shape, defaultConfig)
    }
  })

  bench('advance 250 spring objects × 4 channels (1 frame)', () => {
    // Same motion count as "advance 1,000 active springs".
    const system = createSpringSystem()
    for (let i = 0; i < 250; i++) {
      const spring = system.createSpringObject(shape, defaultConfig)
      spring.target = fullTarget
    }
    system.advance(FRAME)
  })

  bench('settle 100 spring objects to rest (with onUpdate)', () => {
    const system = createSpringSystem()
    let sum = 0
    const springs = Array.from({ length: 100 }, () => {
      const spring = system.createSpringObject(shape, defaultConfig)
      spring.onUpdate(() => {
        sum += spring.value.position.x
      })
      spring.target = fullTarget
      return spring
    })
    while (springs.some((s) => !s.isResting)) {
      system.advance(FRAME)
    }
  })

  bench('settle 100 spring objects to rest (no listeners)', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 100 }, () => {
      const spring = system.createSpringObject(shape, defaultConfig)
      spring.target = fullTarget
      return spring
    })
    while (springs.some((s) => !s.isResting)) {
      system.advance(FRAME)
    }
  })

  bench('partial retargets on 1,000 spring objects', () => {
    const system = createSpringSystem()
    const springs = Array.from({ length: 1_000 }, () =>
      system.createSpringObject(shape, defaultConfig),
    )
    for (const spring of springs) {
      spring.target = { position: { x: 100 } }
    }
  })

  bench('read composite value 10,000 times (4 channels)', () => {
    const system = createSpringSystem()
    const spring = system.createSpringObject(shape, defaultConfig)
    spring.target = fullTarget
    system.advance(FRAME)
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      sum += spring.value.position.x
    }
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
