import { type SlotsType, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring.ts'
import type { SpringConfig, SpringOptions } from '../config.ts'

export interface SpringValueProps {
  target: number
  config?: SpringOptions | SpringConfig
}

export type SpringValueEmits = Record<string, never>

export interface SpringValueSlotScope {
  value: number
  velocity: number
  isResting: boolean
  timeRemaining: number
  jumpTo: (value: number) => void
}

export type SpringValueSlots = SlotsType<{ default: SpringValueSlotScope }>

export const SpringValue = defineComponent<
  SpringValueProps,
  SpringValueEmits,
  string,
  SpringValueSlots
>(
  (props, { slots, expose }) => {
    const { target, config } = toRefs(props)
    const spring = useSpring(target, config)

    expose({
      value: spring,
      velocity: spring.velocity,
      isResting: spring.isResting,
      timeRemaining: spring.timeRemaining,
      jumpTo: spring.jumpTo,
    })

    return () =>
      slots.default?.({
        value: spring.value,
        velocity: spring.velocity.value,
        isResting: spring.isResting.value,
        timeRemaining: spring.timeRemaining.value,
        jumpTo: spring.jumpTo,
      }) ?? null
  },
  {
    name: 'SpringValue',
    props: ['target', 'config'],
  },
)
