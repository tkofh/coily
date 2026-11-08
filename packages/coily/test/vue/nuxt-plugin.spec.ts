import { describe, expect, test, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { createSpringSystem, type SpringSystem } from '../../src/index.ts'
import { provideSpringSystem } from '../../src/vue/index.ts'

const templates: { getContents: () => string }[] = []
vi.mock('@nuxt/kit', () => ({
  defineNuxtModule: (definition: unknown) => definition,
  addPluginTemplate: (template: { getContents: () => string }) => templates.push(template),
  addImports: () => {},
  addComponent: () => {},
}))

/**
 * Runs the module's generated plugin source against stand-ins for Nuxt's
 * globals, with its imports bound to this checkout's source.
 */
async function runPlugin(options: Record<string, unknown>, client: boolean, isHydrating = false) {
  templates.length = 0
  const { default: module } = (await import('../../src/vue/nuxt.ts')) as unknown as {
    default: { setup: (options: Record<string, unknown>) => Promise<void> }
  }
  await module.setup(options)
  const source = templates[0]!.getContents()

  const body = source
    .replace(/^import .*$/gm, '')
    .replace('export default', 'return')
    .replaceAll('import.meta.client', 'client')
  const created: SpringSystem[] = []
  const factory = new Function(
    'createSpringSystem',
    'provideSpringSystem',
    'defineNuxtPlugin',
    'client',
    body,
  )
  const plugin = factory(
    (systemOptions: never) => {
      const system = createSpringSystem(systemOptions)
      created.push(system)
      return system
    },
    provideSpringSystem,
    (setup: unknown) => setup,
    client,
  ) as (nuxtApp: unknown) => void

  const hooks = new Map<string, (app: ReturnType<typeof createApp>) => void>()
  const once = new Map<string, () => void>()
  plugin({
    isHydrating,
    hook: (name: string, callback: never) => hooks.set(name, callback),
    hooks: { hookOnce: (name: string, callback: () => void) => once.set(name, callback) },
  })
  const app = createApp(defineComponent({ render: () => h('div') }))
  hooks.get('app:created')!(app)
  const resolveHydration = () => {
    const callback = once.get('app:suspense:resolve')
    once.delete('app:suspense:resolve')
    callback?.()
  }
  return { app, system: created[0]!, source, resolveHydration }
}

describe('the generated Nuxt plugin', () => {
  test('passes module options to the system', async () => {
    const { system } = await runPlugin({ couplingTolerance: 0.25, reducedMotion: 'never' }, false)
    expect(system.couplingTolerance).toBe(0.25)
    expect(system.reducedMotion).toBe(false)
  })

  test('starts the system on the client only', async () => {
    expect((await runPlugin({}, false)).system.running).toBe(false)
    const { system } = await runPlugin({}, true)
    expect(system.running).toBe(true)
    system.dispose()
  })

  test('disposes the system when the app unmounts', async () => {
    const { app, system } = await runPlugin({}, true)
    app.mount(document.createElement('div'))
    expect(system.running).toBe(true)

    app.unmount()
    expect(system.running).toBe(false)
    expect(() => system.start()).toThrow('Cannot start a disposed spring system')
  })
})

describe('the generated Nuxt plugin while hydrating', () => {
  function preferReduced(matches: boolean) {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList)
  }

  test('holds the server state until hydration ends, then applies the preference', async () => {
    preferReduced(true)
    const { system, resolveHydration } = await runPlugin({}, true, true)
    const ramp = system.createRamp(0, { rate: 100, target: 100 })

    // As the server rendered it: no preference, no frames.
    expect(system.reducedMotion).toBe(false)
    expect(system.running).toBe(false)
    expect(ramp.value).toBe(0)

    resolveHydration()
    expect(system.reducedMotion).toBe(true)
    expect(system.running).toBe(true)
    expect(ramp.value).toBe(100)
    system.dispose()
    vi.restoreAllMocks()
  })

  test('a forced mode applies from the start', async () => {
    const { system } = await runPlugin({ reducedMotion: 'always' }, true, true)
    expect(system.reducedMotion).toBe(true)
    expect(system.running).toBe(true)
    system.dispose()
  })

  test('an app unmounted before hydration ends leaves the system disposed', async () => {
    preferReduced(true)
    const { app, system, resolveHydration } = await runPlugin({}, true, true)
    app.mount(document.createElement('div'))
    app.unmount()
    expect(() => resolveHydration()).not.toThrow()
    expect(system.running).toBe(false)
    vi.restoreAllMocks()
  })
})
