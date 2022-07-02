import type { ComputedRef, Ref } from 'vue'
import type { Spring, SpringState } from 'coiled'

export interface UseSpringReturn {
  state: ComputedRef<SpringState>
  current: ComputedRef<number>
  velocity: ComputedRef<number>
  target: Ref<number>
  freeze: Spring['freeze']
  unfreeze: Spring['unfreeze']
}
