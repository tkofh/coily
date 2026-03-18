import {
  type MaybeRefOrGetter,
  type Ref,
  computed,
  customRef,
  inject,
  toValue,
  watchSyncEffect,
} from 'vue'
import { SpringConfig, type SpringOptions } from '../config.ts'
import { type ChainSpacing } from '../spring-chain.ts'
import { SpringSystemKey } from './system.ts'
import { defaultOptions } from './spring.ts'

export interface SpringChainRef {
  readonly values: readonly Readonly<Ref<number>>[]
  readonly jumpTo: (value: number) => void
}

export interface UseSpringChainOptions {
  config?: MaybeRefOrGetter<SpringOptions | SpringConfig | undefined>
  count: number
  spacing?: ChainSpacing
}

export function useSpringChain(
  target: MaybeRefOrGetter<number>,
  options: UseSpringChainOptions,
): SpringChainRef {
  const system = inject(SpringSystemKey)

  if (!system) {
    throw new Error('No SpringSystem found')
  }

  const config = computed(() => {
    const opts = toValue(options.config)
    if (opts instanceof SpringConfig) return opts
    return new SpringConfig(opts ?? defaultOptions)
  })

  const chain = system.createSpringChain(
    toValue(target),
    options.count,
    config.value,
    options.spacing,
  )

  watchSyncEffect(() => {
    chain.configure(config.value)
  })

  watchSyncEffect(() => {
    chain.target = toValue(target)
  })

  // Create a ref for each link's value
  const triggers: (() => void)[] = []

  chain.onUpdate(() => {
    for (const trigger of triggers) {
      trigger()
    }
  })

  const values: Ref<number>[] = []
  for (let k = 0; k < options.count; k++) {
    const ref = customRef((track, trigger) => {
      triggers.push(trigger)
      return {
        get() {
          track()
          return chain.getValue(k)
        },
        set() {},
      }
    })
    values.push(ref)
  }

  return {
    values,
    jumpTo: (value: number) => chain.jumpTo(value),
  }
}
