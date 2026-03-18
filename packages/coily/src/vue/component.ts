import { type SlotsType, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring.ts'

export interface SpringValueProps {
  target: number
  mass?: number
  tension?: number
  damping?: number
  precision?: number
}

export type SpringValueEmits = Record<string, never>

export interface SpringValueSlotScope {
  value: number
  velocity: number
  isResting: boolean
  timeRemaining: number
}

export type SpringValueSlots = SlotsType<{ default: SpringValueSlotScope }>

export const SpringValue = defineComponent<
  SpringValueProps,
  SpringValueEmits,
  string,
  SpringValueSlots
>(
  (props, { slots }) => {
    const { target, mass, tension, damping, precision } = toRefs(props)
    const spring = useSpring(target, () => ({
      mass: mass?.value ?? 1,
      tension: tension?.value ?? 100,
      damping: damping?.value ?? 10,
      precision: precision?.value ?? 2,
    }))

    return () =>
      slots.default?.({
        value: spring.value.value,
        velocity: spring.velocity.value,
        isResting: spring.isResting.value,
        timeRemaining: spring.timeRemaining.value,
      }) ?? null
  },
  {
    name: 'SpringValue',
    props: ['target', 'mass', 'tension', 'damping', 'precision'],
  },
)
