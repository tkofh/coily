import type { Solver } from './solver'

type TickCallback = (delta: number) => void

export class Scheduler {
  #solvers = new Set<Solver>()
  #callbacks = new Set<TickCallback>()

  tick(delta: number) {
    for (const callback of this.#callbacks.values()) {
      callback(delta)
    }

    for (const solver of this.#solvers.values()) {
      solver.tick(delta)
      if (solver.resting) {
        this.#solvers.delete(solver)
      }
    }

    this.#callbacks.clear()
  }

  add(solver: Solver) {
    this.#solvers.add(solver)
  }

  remove(solver: Solver) {
    this.#solvers.delete(solver)
  }

  has(solver: Solver) {
    return this.#solvers.has(solver)
  }

  once(callback: TickCallback) {
    this.#callbacks.add(callback)
  }
}
