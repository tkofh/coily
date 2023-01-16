import type { ComputedRef, Ref } from 'vue'
import type {
  SpringConfig,
  SpringState,
  SpringOptions as SpringOptionsBase,
  SpringChainLinkGetter,
} from 'coily'

export type Reactable<T> = T | Ref<T> | (() => T)

export interface SpringOptions extends Partial<SpringOptionsBase> {
  frozen?: Ref<boolean>
}

export type ReactableResult<TInput, T, TReadonly = T> = TInput extends (() => T) | ComputedRef<T>
  ? ComputedRef<TReadonly>
  : Ref<T>

export type SpringEventHookCleanup = () => void
export type SpringEventHook<TData> = (handler: (data: TData) => void) => SpringEventHookCleanup

export interface UseSpringReturn<
  TTarget extends Reactable<number>,
  TConfig extends Reactable<SpringConfig>,
  TOptions extends SpringOptions | undefined
> {
  state: ComputedRef<SpringState>
  current: ComputedRef<number>
  velocity: ComputedRef<number>
  target: ReactableResult<TTarget, number>
  config: ReactableResult<TConfig, SpringConfig>
  frozen: ReactableResult<TOptions extends SpringOptions ? TOptions['frozen'] : boolean, boolean>
  onValueChange: SpringEventHook<number>
  onStateChange: SpringEventHook<SpringState>
}

export interface UseSpringChainReturn<
  TTarget extends Reactable<number>,
  TLinks extends Reactable<SpringChainLinkGetter[]>,
  TConfig extends Reactable<SpringConfig>,
  TOptions extends SpringOptions | undefined
> {
  state: ComputedRef<SpringState>
  states: ComputedRef<ReadonlyArray<SpringState>>
  current: ComputedRef<ReadonlyArray<number>>
  velocities: ComputedRef<ReadonlyArray<number>>
  target: ReactableResult<TTarget, number>
  config: ReactableResult<TConfig, SpringConfig>
  targets: ComputedRef<ReadonlyArray<number>>
  links: ReactableResult<TLinks, SpringChainLinkGetter[], ReadonlyArray<SpringChainLinkGetter>>
  frozen: ReactableResult<TOptions extends SpringOptions ? TOptions['frozen'] : boolean, boolean>
  onValueChange: SpringEventHook<number[]>
  onStateChange: SpringEventHook<SpringState>
}
