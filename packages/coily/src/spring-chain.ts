import type { SpringConfig } from './config.ts'
import type { MotionSet } from './motion.ts'
import { ChainMotion } from './chain-motion.ts'

export type ChainSpacing = number | ((index: number, total: number, netOffset: number) => number)

export class SpringChain {
  #target: number
  readonly #motion: ChainMotion
  readonly #motions: MotionSet
  readonly #offsets: number[]
  readonly #count: number

  constructor(
    motions: MotionSet,
    target: number,
    count: number,
    config: SpringConfig,
    spacing: ChainSpacing = 0,
  ) {
    this.#target = target
    this.#count = count
    this.#motions = motions
    this.#motion = new ChainMotion(config, count)
    this.#offsets = computeOffsets(count, spacing)
  }

  get target() {
    return this.#target
  }

  set target(value: number) {
    if (value === this.#target) return

    const { positions, velocities } = this.#captureState()
    this.#target = value
    this.#motion.reset(positions, velocities)
    this.#motions.add(this.#motion)
  }

  get count() {
    return this.#count
  }

  getValue(k: number) {
    return this.#motion.getPosition(k, this.#target, this.#offsets)
  }

  get isResting() {
    return this.#motion.isResting
  }

  configure(config: SpringConfig) {
    const { positions, velocities } = this.#captureState()
    this.#motion.configure(config, positions, velocities)
    this.#motions.add(this.#motion)
  }

  onUpdate(callback: () => void) {
    return this.#motion.onUpdate(callback)
  }

  onStop(callback: () => void) {
    return this.#motion.onStop(callback)
  }

  jumpTo(value: number) {
    this.#target = value
    this.#motion.rest()
  }

  dispose() {
    this.#motions.remove(this.#motion)
    this.#motion.dispose()
  }

  #captureState() {
    const positions: number[] = []
    const velocities: number[] = []

    for (let k = 0; k < this.#count; k++) {
      if (k === 0) {
        positions.push(this.getValue(0) - this.#target - this.#offsets[0]!)
      } else {
        const linkSpacing = this.#offsets[k]! - this.#offsets[k - 1]!
        positions.push(this.getValue(k) - this.getValue(k - 1) - linkSpacing)
      }
      velocities.push(0) // TODO: track properly
    }

    return { positions, velocities }
  }
}

function computeOffsets(count: number, spacing: ChainSpacing): number[] {
  const offsets: number[] = []
  if (typeof spacing === 'number') {
    for (let i = 0; i < count; i++) {
      offsets.push(spacing * (i + 1))
    }
  } else {
    let netOffset = 0
    for (let i = 0; i < count; i++) {
      netOffset += spacing(i, count, netOffset)
      offsets.push(netOffset)
    }
  }
  return offsets
}
