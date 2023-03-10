import mitt from 'mitt'
import type {
  SimulateFn,
  Spring,
  SpringArrivalBehavior,
  SpringConfig,
  SpringEmitter,
  SpringOptions,
  SpringState,
} from '../types'

const getArrivalFunction = (behavior: SpringArrivalBehavior): ((velocity: number) => number) => {
  let result

  if (typeof behavior === 'function') {
    result = behavior
  } else {
    let scalar: number
    if (typeof behavior === 'number') {
      scalar = behavior
    } else if (behavior === 'bounce') {
      scalar = -1
    } else if (behavior === 'clamp') {
      scalar = 0
    } else if (behavior === 'none') {
      scalar = 1
    }
    result = (velocity: number) => velocity * scalar
  }

  return result
}

export const createSpringImpl = (
  initial: number,
  config: SpringConfig,
  options?: SpringOptions
): [Spring, SimulateFn] => {
  let state: SpringState = 'resting'

  let velocity = 0
  let target = initial
  let value = initial

  const restingDistance = Math.max(options?.restingDistance ?? 0.0001, 0)
  const restingVelocity = Math.max(options?.restingVelocity ?? 0.0001, 0)
  const arrivalFunction = getArrivalFunction(options?.arrivalBehavior ?? 1)

  const emitter: SpringEmitter = mitt()

  const { emit, ...emitterApi } = emitter

  const spring: Spring = {
    ...emitterApi,
    get target() {
      return target
    },
    set target(val) {
      target = val
      if (state !== 'moving' && Math.abs(value - target) > restingDistance) {
        state = 'moving'
        emit('update:state', state)
      }
    },
    getTarget: () => target,

    get value() {
      return value
    },
    getValue: () => value,

    get velocity() {
      return velocity
    },
    getVelocity: () => velocity,

    get state() {
      return state
    },
    getState: () => state,

    get config() {
      return config
    },
    set config(value) {
      config = value
    },
    getConfig: () => config,

    jumpTo: (_value, killVelocity = true) => {
      value = _value

      if (killVelocity) {
        velocity = 0
      }

      state =
        Math.abs(velocity) > restingVelocity || Math.abs(value - target) > restingDistance
          ? 'moving'
          : 'resting'
    },

    freeze: () => {
      state = 'frozen'
      emit('update:state', state)
    },
    unfreeze: () => {
      state =
        Math.abs(velocity) > restingVelocity || Math.abs(value - target) > restingDistance
          ? 'moving'
          : 'resting'
      emit('update:state', state)
    },
  }

  const tension = -config.tension * 0.000001
  const friction = -config.friction * 0.001

  const simulate: SimulateFn = (deltaTime) => {
    if (state === 'moving') {
      const iterations = Math.ceil(deltaTime)

      for (let n = 0; n < iterations; n++) {
        const previousDelta = value - target

        const springForce = tension * previousDelta
        const dampingForce = friction * velocity
        const acceleration = (springForce + dampingForce) / config.mass

        velocity = velocity + acceleration
        value = value + velocity

        const delta = value - target
        const absDelta = Math.abs(delta)

        if (Math.sign(delta) !== Math.sign(previousDelta)) {
          velocity = arrivalFunction(velocity * 1000) * 0.001

          value = target + velocity * (absDelta / (absDelta + Math.abs(previousDelta)))
        }

        if (absDelta < restingDistance && Math.abs(velocity) < restingVelocity) {
          value = target
          state = 'resting'
          emit('update:state', state)
          break
        }
      }

      emit('update:value', value)
    }
  }

  return [spring, simulate]
}
