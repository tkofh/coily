import type { Emitter } from 'mitt'

export interface SpringConfig {
  mass: number
  tension: number
  friction: number
}

export type SpringArrivalBehavior =
  | 'bounce'
  | 'clamp'
  | 'none'
  | number
  | ((velocity: number) => number)

export interface SpringOptions {
  restingDistance?: number
  restingVelocity?: number
  arrivalBehavior?: SpringArrivalBehavior
}

export type SpringState = 'moving' | 'frozen' | 'resting'

export type SpringEmitter = Emitter<{
  'update:value': number
  'update:state': SpringState
  '*': number | SpringState
}>

export interface Spring extends Omit<SpringEmitter, 'emit'> {
  target: number
  readonly getTarget: () => number

  config: Readonly<SpringConfig>
  readonly getConfig: () => Readonly<SpringConfig>

  readonly value: number
  readonly getValue: () => number

  readonly velocity: number
  readonly getVelocity: () => number

  readonly state: SpringState
  readonly getState: () => SpringState

  readonly jumpTo: (value: number, killVelocity?: boolean) => void

  readonly freeze: () => void
  readonly unfreeze: () => void
}

export type SimulateFn = (delta: number) => void

export interface StandaloneSpring extends Spring {
  readonly simulate: SimulateFn
}

export type SpringChainLinkGetter =
  | number
  | ((
      previousValue: number,
      previousTarget: number,
      currentValue?: number,
      currentTarget?: number
    ) => number)

export type SpringChainEmitter = Emitter<{
  'update:value': number[]
  'update:state': SpringState
  '*': number[] | SpringState
}>

export interface SpringChain extends Omit<SpringChainEmitter, 'emit'> {
  target: number
  readonly getTarget: () => number

  links: SpringChainLinkGetter[]

  config: Readonly<SpringConfig>
  readonly getConfig: () => Readonly<SpringConfig>

  readonly targets: ReadonlyArray<number>
  readonly getTargets: () => ReadonlyArray<number>

  readonly values: ReadonlyArray<number>
  readonly getValues: () => ReadonlyArray<number>

  readonly velocities: ReadonlyArray<number>
  readonly getVelocities: () => ReadonlyArray<number>

  readonly state: SpringState
  readonly getState: () => SpringState

  readonly states: ReadonlyArray<SpringState>
  readonly getStates: () => ReadonlyArray<SpringState>

  readonly freeze: () => void
  readonly unfreeze: () => void
}

export interface StandaloneSpringChain extends SpringChain {
  readonly simulate: SimulateFn
}

export type SpringSystemEmitter = Emitter<{
  // 'simulate:before': never
  'simulate:after': number
  '*': number
}>

export interface SpringSystem extends Omit<SpringSystemEmitter, 'emit'> {
  createSpring: (initial: number, config: SpringConfig, options?: SpringOptions) => Spring
  createSpringChain: (
    initial: number,
    links: SpringChainLinkGetter[],
    config: SpringConfig,
    options?: SpringOptions
  ) => SpringChain
  cleanup: (spring: Spring | SpringChain) => void
  simulate: SimulateFn
}
