import type { Solver } from './solver.ts'

export class SolverSet {
  readonly #solvers = new Set<Solver>()

  add(solver: Solver) {
    this.#solvers.add(solver)
  }

  remove(solver: Solver) {
    this.#solvers.delete(solver)
  }

  tick(dt: number) {
    for (const solver of this.#solvers) {
      solver.tick(dt)
      if (solver.resting) {
        this.#solvers.delete(solver)
      }
    }
  }
}
