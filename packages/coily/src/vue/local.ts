import {
  type ComponentInternalInstance,
  type InjectionKey,
  getCurrentInstance,
  inject,
  provide,
} from 'vue'

// Vue's provide() hides the value from the providing component's own
// inject(). These helpers keep a side table per instance, so a component
// can inject what it provides. useSpringSystem needs this at the root,
// where the component that creates the system also animates.
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
