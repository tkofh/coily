import type { Ref } from 'vue'
import { isRef, computed, ref } from 'vue'
import type { Reactable } from './types'

export const paramToRef = <T>(param: Reactable<T>): Ref<T> => {
  if (isRef(param)) {
    return param
  } else if (typeof param === 'function') {
    return computed(param as () => T)
  } else {
    return ref(param) as Ref<T>
  }
}
