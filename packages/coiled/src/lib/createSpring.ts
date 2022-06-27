import type { SimulateFn, Spring, SpringConfig, SpringOptions, SpringState } from '../types'

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

  const spring: Spring = {
    get target() {
      return target
    },
    set target(val) {
      target = val
      if (Math.abs(value - target) > restingDistance) {
        state = 'moving'
      }
    },
    get value() {
      return value
    },
    get velocity() {
      return velocity
    },
    get state() {
      return state
    },
    get config() {
      return config
    },
    set config(value) {
      config = value
    },
    freeze: () => {
      state = 'frozen'
    },
    unfreeze: () => {
      state = velocity > restingVelocity ? 'moving' : 'resting'
    },
  }

  const simulate: SimulateFn = (delta) => {
    if (state === 'moving') {
      const iterations = Math.ceil(delta)

      for (let n = 0; n < iterations; n++) {
        const springForce = -config.tension * 0.000001 * (value - target)
        const dampingForce = -config.friction * 0.001 * velocity
        const acceleration = (springForce + dampingForce) / config.mass // pt/ms^2

        velocity = velocity + acceleration // pt/ms
        value = value + velocity

        if (Math.abs(value - target) < restingDistance && Math.abs(velocity) < restingVelocity) {
          value = target
          state = 'resting'
          break
        }
      }
    }
  }

  return [spring, simulate]
}
