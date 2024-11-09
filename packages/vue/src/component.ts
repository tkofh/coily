import { type SlotsType, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring'

export interface SpringValueProps {
  target: number
  mass?: number
  tension?: number
  friction?: number
  precision?: number
}

export type SpringValueEmits = Record<string, never>

export type SpringValueSlots = SlotsType<{
  default: { value: number; velocity: number; resting: boolean }
}>

export const SpringValue = defineComponent<
  SpringValueProps,
  SpringValueEmits,
  string,
  SpringValueSlots
>(
  (props, { slots }) => {
    const { target, mass, tension, friction, precision } = toRefs(props)
    const spring = useSpring(target, () => ({
      mass: mass?.value ?? 1,
      tension: tension?.value ?? 100,
      damping: friction?.value ?? 10,
      precision: precision?.value ?? 2,
    }))

    return () => {
      return (
        slots.default?.({
          value: spring.value.value,
          velocity: spring.velocity.value,
          resting: spring.resting.value,
        }) ?? null
      )
    }
  },
  {
    name: 'SpringValue',
    props: ['target', 'mass', 'tension', 'friction', 'precision'],
  },
)
