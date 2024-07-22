import { type SlotsType, type VNode, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring'

interface SpringValueProps {
  target: number
  mass?: number
  tension?: number
  friction?: number
  precision?: number
}

export const SpringValue = defineComponent(
  (props: SpringValueProps, { slots }) => {
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
    slots: {} as SlotsType<{
      default: (props: {
        value: number
        velocity: number
        resting: boolean
      }) => Array<VNode>
    }>,
  },
)
