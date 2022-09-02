import type { InjectionKey } from 'vue'
import type { SpringSystem } from '../../coily'

export const SPRING_SYSTEM = Symbol('SPRING_SYSTEM') as InjectionKey<SpringSystem>
