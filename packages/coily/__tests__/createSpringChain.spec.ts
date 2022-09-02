import { describe, test } from 'vitest'
import { createSpringChain } from '../src'

describe('createSpringChain', () => {
  test('it creates a standalone spring chain', ({ expect }) => {
    const chain = createSpringChain(10, [(val) => val + 10, (val) => val + 10], {
      mass: 1,
      tension: 150,
      friction: 30,
    })

    chain.target = 0

    expect(chain.values).toStrictEqual([10, 20, 30])

    chain.simulate(2000)
    // console.log({
    //   target: chain.target,
    //   targets: chain.targets,
    //   values: chain.values,
    //   velocities: chain.velocities,
    //   state: chain.state,
    //   states: chain.states,
    // })
  })
})
