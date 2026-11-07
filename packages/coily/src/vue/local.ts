import {
  type ComponentInternalInstance,
  type InjectionKey,
  getCurrentInstance,
  inject,
  provide,
} from 'vue'

// Vue's inject() cannot see the calling component's own provide(), so
// these helpers keep a per-instance side table. useSpringSystem needs it
// at the root, where the component creating the system also animates.
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
