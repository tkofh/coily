import type { SpringConfig } from './config.ts'
import { State } from './state.ts'

export class ChainState {
  readonly #states: State[]

  constructor(config: SpringConfig, count: number) {
    this.#states = Array.from({ length: count }, () => new State(config, 0, 0))
  }

  get(k: number): State {
    return this.#states[k]!
  }

  configure(config: SpringConfig) {
    for (const state of this.#states) {
      state.configure(config)
    }
  }

  get isResting() {
    return this.#states.every((s) => s.isResting)
  }
}
