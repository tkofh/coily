import mitt from 'mitt'
import type {
  Spring,
  SpringConfig,
  SpringChainLinkGetter,
  SpringOptions,
  SimulateFn,
  SpringState,
  SpringChain,
  SpringChainEmitter,
} from '../types'
import { createSpringImpl } from './createSpring'

export const createSpringChainImpl = (
  initial: number,
  links: SpringChainLinkGetter[],
  config: SpringConfig,
  options?: SpringOptions
): [SpringChain, SimulateFn] => {
  const simulateFns: SimulateFn[] = []
  const springs: Spring[] = []
  const targets: number[] = []
  const values: number[] = []
  const velocities: number[] = []
  const states: SpringState[] = []

  let currentTarget: number = initial
  let currentLinks: SpringChainLinkGetter[] = links
  let state: SpringState = 'resting'

  const updateChainState = (target: number, links: SpringChainLinkGetter[]) => {
    if (springs.length === 0) {
      const [spring, simulate] = createSpringImpl(target, config, options)
      springs.push(spring)
      simulateFns.push(simulate)
      targets.push(spring.target)
      values.push(spring.value)
      velocities.push(spring.velocity)
      states.push(spring.state)
    } else {
      springs[0].target = target
      targets[0] = target
      states[0] = springs[0].state

      if (state === 'resting' && springs[0].state === 'moving') {
        state = 'moving'
      }
    }

    for (const [index, link] of links.entries()) {
      const previousSpring = springs[index]
      if (springs[index + 1]) {
        const spring = springs[index + 1]
        if (typeof link === 'number') {
          spring.target = previousSpring.value + link
        } else {
          spring.target = link(
            previousSpring.value,
            previousSpring.target,
            spring.value,
            spring.target
          )
        }
        // value and velocity won't change until simulate() is called
        targets[index + 1] = spring.target
        states[index + 1] = spring.state

        if (state === 'resting' && spring.state === 'moving') {
          state = 'moving'
        }
      } else {
        const [spring, simulate] = createSpringImpl(
          typeof link === 'number'
            ? previousSpring.value + link
            : link(previousSpring.value, previousSpring.target),
          config,
          options
        )
        springs.push(spring)
        simulateFns.push(simulate)
        targets[index + 1] = spring.target
        values[index + 1] = spring.value
        velocities[index + 1] = spring.velocity
        states[index + 1] = spring.state
      }
    }

    const cutoff = springs.length + 1
    if (springs.length > cutoff) {
      const deleteCount = springs.length - cutoff
      springs.splice(cutoff, deleteCount)
      simulateFns.splice(cutoff, deleteCount)
      targets.splice(cutoff, deleteCount)
      values.splice(cutoff, deleteCount)
      velocities.splice(cutoff, deleteCount)
      states.splice(cutoff, deleteCount)
    }
  }

  updateChainState(currentTarget, currentLinks)

  const emitter: SpringChainEmitter = mitt()
  const { emit, ...emitterApi } = emitter

  const simulate: SimulateFn = (delta) => {
    if (state === 'moving') {
      let moving = false
      for (let i = 0; i < springs.length; i++) {
        simulateFns[i](delta)
        if (i < springs.length - 1) {
          const link = links[i]
          springs[i + 1].target =
            typeof link === 'number'
              ? springs[i].value + link
              : link(springs[i].value, springs[i].target, springs[i + 1].value)
        }
        targets[i] = springs[i].target
        values[i] = springs[i].value
        velocities[i] = springs[i].velocity
        states[i] = springs[i].state

        moving = moving || springs[i].state === 'moving'
      }
      emit('update:value', values)

      if (!moving) {
        state = 'resting'
        emit('update:state', state)
      }
    }
  }

  return [
    {
      ...emitterApi,
      get target() {
        return targets[0]
      },
      set target(val: number) {
        currentTarget = val
        updateChainState(currentTarget, currentLinks)
      },
      getTarget: () => targets[0],

      get targets() {
        return targets
      },
      getTargets: () => targets,

      get links() {
        return links
      },
      set links(val: SpringChainLinkGetter[]) {
        currentLinks = val
        updateChainState(currentTarget, currentLinks)
      },

      get config() {
        return config
      },
      getConfig: () => config,

      get values() {
        return values
      },
      getValues: () => values,

      get velocities() {
        return velocities
      },
      getVelocities: () => velocities,

      get state() {
        return state
      },
      getState: () => state,

      get states() {
        return states
      },
      getStates: () => states,

      freeze: () => {
        for (const spring of springs) {
          spring.freeze()
        }
        state = 'frozen'
        emit('update:state', state)
      },
      unfreeze: () => {
        let moving = false
        for (const spring of springs) {
          spring.unfreeze()
          moving = moving || spring.state === 'moving'
        }
        state = moving ? 'moving' : 'resting'
        emit('update:state', state)
      },
    },
    simulate,
  ]
}
