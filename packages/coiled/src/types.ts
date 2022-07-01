import type { Emitter } from 'mitt'

export interface SpringConfig {
  mass: number
  tension: number
  friction: number
}

export interface SpringOptions {
  restingDistance: number
  restingVelocity: number
}

export type SpringState = 'moving' | 'frozen' | 'resting'

export type SpringEmitter = Emitter<{
  'update:value': number
  'update:state': SpringState
  '*': number | SpringState
}>

export interface Spring extends Omit<SpringEmitter, 'emit'> {
  target: number
  config: Readonly<SpringConfig>
  readonly value: number
  readonly velocity: number
  readonly state: SpringState
  readonly freeze: () => void
  readonly unfreeze: () => void
}

export type SimulateFn = (delta: number) => void

export interface StandaloneSpring extends Spring {
  readonly simulate: SimulateFn
}

export interface SpringSystem {
  createSpring: (initial: number, config: SpringConfig, options?: SpringOptions) => Spring
  cleanup: (spring: Spring) => void
  simulate: SimulateFn
}
