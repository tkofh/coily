// Prototype ramp source for the constant-rate proposal: a value moving
// toward `target` at a fixed `rate` (units per second), wired into the
// real MotionSet / FollowGraph as a Motion subclass so followers get
// ranked, sub-stepped, and FOH-recoupled exactly as they would against a
// shipped primitive. Probe-only: the proposal replaces the subclass with
// a shared tick-member interface.
import { SpringDefinition } from '../../packages/coily/src/config.ts'
import { Emitter } from '../../packages/coily/src/emitter.ts'
import { registerBacking } from '../../packages/coily/src/follow-graph.ts'
import { Motion } from '../../packages/coily/src/motion.ts'
import { MotionSet } from '../../packages/coily/src/motion-set.ts'
import { Spring } from '../../packages/coily/src/spring.ts'
import { SpringSourceSymbol, type SpringSource } from '../../packages/coily/src/spring-source.ts'

export class RampMotion extends Motion {
  value: number
  rate: number
  rampTarget: number
  readonly emitter = new Emitter()

  constructor(from: number, rate: number, target: number) {
    super(SpringDefinition.default, 0, 0)
    this.value = from
    this.rate = rate
    this.rampTarget = target
  }

  override get isResting(): boolean {
    return this.rate === 0 || this.value === this.rampTarget
  }

  override get velocity(): number {
    if (this.isResting) return 0
    return Math.sign(this.rampTarget - this.value) * this.rate
  }

  override _advance(dt: number): void {
    if (this.isResting) return
    const remaining = this.rampTarget - this.value
    const step = this.rate * dt
    this.value =
      Math.abs(remaining) <= step ? this.rampTarget : this.value + Math.sign(remaining) * step
  }

  override _settleFrame(): void {
    this.emitter.emit('update')
  }

  override _manifoldDeviation(): number {
    return 0
  }

  override _acceleration(): number {
    return 0
  }
}

export interface Ramp extends SpringSource {
  readonly motion: RampMotion
}

export function createRamp(
  motions: MotionSet,
  from: number,
  options: { rate: number; target: number },
): Ramp {
  const motion = new RampMotion(from, options.rate, options.target)
  const api = {
    get value() {
      return motion.value
    },
    get velocity() {
      return motion.velocity
    },
    acceleration: 0,
    get target() {
      return motion.rampTarget
    },
    onUpdate: (cb: () => void) => motion.emitter.on('update', cb),
    onDispose: (cb: () => void) => motion.emitter.on('dispose', cb),
  }
  const ramp = { [SpringSourceSymbol]: api, motion }
  registerBacking(ramp, motion)
  if (!motion.isResting) motions.add(motion)
  return ramp
}

export { MotionSet, Spring, SpringDefinition }
