import type { SpringSystem } from 'coily'
import type { InjectionKey } from 'vue'

export const SpringSystemKey: InjectionKey<SpringSystem> = Symbol.for(
  'coily/spring-system',
)
