import type { ComputedRef, Ref } from 'vue'
import type { Spring, SpringConfig, SpringState, SpringOptions as SpringOptionsBase } from 'coiled'

export type Reactable<T> = T | Ref<T> | (() => T)

export interface SpringOptions extends Partial<SpringOptionsBase> {
  frozen?: Ref<boolean>
}

export interface UseSpringReturn<
  TTarget extends Reactable<number>,
  TOptions extends SpringOptions | undefined
> {
  state: ComputedRef<SpringState>
  current: ComputedRef<number>
  velocity: ComputedRef<number>
  config: ComputedRef<SpringConfig>
  target: TTarget extends number | (() => number) | ComputedRef<number>
    ? ComputedRef<number>
    : Ref<number>
  freeze: TOptions extends { frozen: Ref<boolean> } ? never : Spring['freeze']
  unfreeze: TOptions extends { frozen: Ref<boolean> } ? never : Spring['unfreeze']
}
