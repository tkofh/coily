import type { Solver } from './solver'

export class Scheduler {
  #solvers = new Set<Solver>()

  tick(delta: number) {
    for (const solver of this.#solvers.values()) {
      solver.tick(delta)
      if (solver.resting) {
        this.#solvers.delete(solver)
      }
    }
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
}
