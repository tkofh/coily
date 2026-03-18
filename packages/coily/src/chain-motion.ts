import { type SpringConfig } from './config.ts'
import { Emitter } from './emitter.ts'
import type { Motion } from './motion.ts'
import { ChainState } from './chain-state.ts'
import { UnderdampedChainSolver } from './chain-solver.ts'

export class ChainMotion implements Motion {
  #config: SpringConfig
  readonly #state: ChainState
  readonly #solver: UnderdampedChainSolver
  readonly #emitter: Emitter
  readonly #count: number

  constructor(config: SpringConfig, count: number) {
    this.#config = config
    this.#count = count
    this.#state = new ChainState(config, count)
    this.#solver = new UnderdampedChainSolver(this.#state, count)
    this.#emitter = new Emitter()

    this.#solver.configure(config)
  }

  get isResting() {
    return this.#state.isResting
  }

  getDisplacement(k: number) {
    return this.#state.get(k).position
  }

  getPosition(k: number, leaderTarget: number, offsets: number[]) {
    let pos = leaderTarget + offsets[k]!
    for (let i = 0; i <= k; i++) {
      pos += this.#state.get(i).position
    }
    return pos
  }

  configure(
    config: SpringConfig,
    positions: number[],
    velocities: number[],
  ) {
    this.#config = config
    this.#state.configure(config)
    for (let k = 0; k < this.#count; k++) {
      this.#state.get(k).position = positions[k]!
      this.#state.get(k).velocity = velocities[k]!
    }
    this.#solver.configure(config)
  }

  reset(positions: number[], velocities: number[]) {
    for (let k = 0; k < this.#count; k++) {
      this.#state.get(k).position = positions[k]!
      this.#state.get(k).velocity = velocities[k]!
    }
    this.#solver.configure(this.#config)
  }

  rest() {
    for (let k = 0; k < this.#count; k++) {
      this.#state.get(k).position = 0
      this.#state.get(k).velocity = 0
    }
    this.#solver.configure(this.#config)
    this.#emitter.emit('update')
  }

  tick(dt: number) {
    this.#solver.tick(dt)
    this.#emitter.emit('update')

    if (this.#state.isResting) {
      this.#emitter.emit('stop')
    }
  }

  onUpdate(callback: () => void) {
    return this.#emitter.on('update', callback)
  }

  onStop(callback: () => void) {
    return this.#emitter.on('stop', callback)
  }

  dispose() {
    this.#emitter.clear()
  }
}
