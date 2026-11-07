import { type SlotsType, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring.ts'
import type { SpringDefinition, SpringDefinitionOptions } from '../config.ts'
import type { Purpose } from '../spring.ts'

export interface SpringValueProps {
  /** The value to animate toward. A new value retargets the spring and keeps its momentum. */
  target: number
  /**
   * Spring config: a `SpringDefinition` or any option shape `defineSpring`
   * accepts. A new config reconfigures the spring in place. Without it,
   * the spring uses the default config.
   */
  config?: SpringDefinitionOptions | SpringDefinition
  /**
   * What the spring animates, `'motion'` or `'nonmotion'`. A
   * `'nonmotion'` spring, such as a cross-fade or a color, keeps
   * animating under reduced motion. The component reads it once, in
   * `setup()`, and ignores later changes.
   * @default 'motion'
   */
  purpose?: Purpose
}

/** `SpringValue` emits no events. */
export type SpringValueEmits = Record<string, never>

/** What `SpringValue` passes to its default slot. */
export interface SpringValueSlotScope {
  /** The current animated value. */
  value: number
  /** The current velocity, in value units per second. */
  velocity: number
  /** Whether the spring is resting. */
  isResting: boolean
  /** Estimated milliseconds until the spring rests. */
  timeRemaining: number
  /**
   * Snaps the spring to `value` with no animation, target included. The
   * spring rests there until the `target` prop changes.
   */
  jumpTo: (value: number) => void
}

/** Slot types: `default` receives the live `SpringValueSlotScope`. */
export type SpringValueSlots = SlotsType<{ default: SpringValueSlotScope }>

/**
 * A renderless component that passes one spring's state to its default
 * slot. It is the template-only form of `useSpring`. It must render
 * below a provided spring system. A template ref to the component
 * reads the same fields as the slot scope.
 *
 * @example
 * ```vue
 * <SpringValue :target="expanded ? 1 : 0" purpose="nonmotion" v-slot="{ value }">
 *   <div :style="{ opacity: value }" />
 * </SpringValue>
 * ```
 */
export const SpringValue = defineComponent<
  SpringValueProps,
  SpringValueEmits,
  string,
  SpringValueSlots
>(
  (props, { slots, expose }) => {
    const { target, config } = toRefs(props)
    // Purpose is fixed at creation, so setup reads the prop once instead of passing a ref.
    const spring = useSpring(target, config, { purpose: props.purpose })

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
    props: ['target', 'config', 'purpose'],
  },
)
