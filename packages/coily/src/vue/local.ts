import {
  type ComponentInternalInstance,
  type InjectionKey,
  getCurrentInstance,
  inject,
  provide,
} from 'vue'

/**
 * Vue's `provide` is only visible to descendants — a component cannot
 * `inject` what it provided itself. These wrappers additionally record
 * provided values per component instance so same-component lookups work,
 * which is what lets `useSpringSystem()` be idempotent within one setup.
 * (Same pattern as VueUse's `provideLocal`/`injectLocal`, inlined.)
 */
const localProvides = new WeakMap<ComponentInternalInstance, Map<InjectionKey<unknown>, unknown>>()

export function provideLocal<T>(key: InjectionKey<T>, value: T) {
  const instance = getCurrentInstance()
  if (instance) {
    let values = localProvides.get(instance)
    if (!values) {
      values = new Map()
      localProvides.set(instance, values)
    }
    values.set(key, value)
  }
  provide(key, value)
}

export function injectLocal<T>(key: InjectionKey<T>): T | undefined {
  const instance = getCurrentInstance()
  if (instance) {
    const values = localProvides.get(instance)
    if (values?.has(key)) {
      return values.get(key) as T
    }
  }
  return inject(key, undefined)
}
