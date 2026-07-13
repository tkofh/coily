import { type SlotsType, defineComponent, toRefs } from 'vue'
import { useSpring } from './spring.ts'
import type { SpringDefinition, SpringDefinitionOptions } from '../config.ts'
import type { Purpose } from '../spring.ts'

export interface SpringValueProps {
  /** The value to animate toward. Changing it retargets the spring, momentum intact. */
  target: number
  /**
   * Spring config: a `SpringDefinition` or any option shape `defineSpring`
   * accepts. Changing it reconfigures the spring in place; omit it for
   * the default.
   */
  config?: SpringDefinitionOptions | SpringDefinition
  /**
   * What the spring animates — `'motion'` (default) or `'appearance'`.
   * `'appearance'` (a cross-fade, a color) keeps animating under reduced
   * motion. Read once at mount; later changes are ignored.
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
  /** Snaps the spring to `value` with no animation, target included. */
  jumpTo: (value: number) => void
}

/** Slot types: `default` receives the live `SpringValueSlotScope`. */
export type SpringValueSlots = SlotsType<{ default: SpringValueSlotScope }>

/**
 * Renderless component exposing one springed number through its default
 * slot — the template-only sibling of `useSpring`. Must sit below a
 * provided spring system.
 *
 * @example
 * ```vue
 * <SpringValue :target="expanded ? 1 : 0" purpose="appearance" v-slot="{ value }">
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
    // purpose is fixed at creation, so read it once rather than as a ref.
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
