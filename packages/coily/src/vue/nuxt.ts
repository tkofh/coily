import { addComponent, addImports, addPluginTemplate, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'
import type { ReducedMotionMode } from '../system.ts'

/**
 * Options for the `coily` key in `nuxt.config`, passed to the app-wide
 * spring system the module creates.
 */
export interface CoilyModuleOptions {
  /**
   * Log active motion counts to the console whenever they change.
   * @default false
   */
  debug?: boolean
  /**
   * Frame-rate cap. 0 means uncapped: one tick per displayed frame. A
   * capped tick lands on a whole display frame and receives the true
   * elapsed time in ms.
   * @default 0
   */
  fps?: number
  /**
   * The frame gap in ms above which the system treats the gap as lag and
   * replaces it with `adjustedLag`, so springs do not jump when frames
   * resume. 0 turns off lag clamping.
   * @default 500
   */
  lagThreshold?: number
  /**
   * The elapsed time in ms that replaces a lagging frame. A frame uses
   * at most `lagThreshold` ms of it.
   * @default 33
   */
  adjustedLag?: number
  /**
   * How far a spring can trail a source it follows within one frame, in
   * the value's own units. Frames whose motion would exceed it run as
   * sub-steps, so a smaller value follows more closely at more cost.
   * @default 0.1
   */
  couplingTolerance?: number
  /**
   * When springs snap to their targets instead of animating. `'user'`
   * follows the OS prefers-reduced-motion setting, including live
   * changes. `'always'` and `'never'` force one behavior. Under `'user'`,
   * a server-rendered page hydrates without the preference, as the server
   * rendered it, and applies it once hydration finishes.
   * @default 'user'
   */
  reducedMotion?: ReducedMotionMode
}

function getPluginTemplate(options: CoilyModuleOptions) {
  const systemOptions: Record<string, unknown> = {}
  if (options.debug) systemOptions.debug = true
  if (options.fps !== undefined) systemOptions.fps = options.fps
  if (options.lagThreshold !== undefined) systemOptions.lagThreshold = options.lagThreshold
  if (options.adjustedLag !== undefined) systemOptions.adjustedLag = options.adjustedLag
  if (options.couplingTolerance !== undefined)
    systemOptions.couplingTolerance = options.couplingTolerance
  const mode = JSON.stringify(options.reducedMotion ?? 'user')

  return `import { createSpringSystem } from 'coily'
import { provideSpringSystem } from 'coily/vue'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:created', (vueApp) => {
    const mode = ${mode}
    // The server reads no reduced-motion preference, so hydration must not
    // either, or a ramp or retarget would render a different first value.
    // The system holds still until hydration ends, then takes the mode.
    const hydrating = import.meta.client && nuxtApp.isHydrating && mode === 'user'
    const system = createSpringSystem({ ...${JSON.stringify(systemOptions)}, reducedMotion: hydrating ? 'never' : mode })
    provideSpringSystem(system, vueApp)
    // The app owns the system: its ticker and its visibility and
    // reduced-motion listeners end with it, including on a dev reload.
    let unmounted = false
    vueApp.onUnmount(() => {
      unmounted = true
      system.dispose()
    })

    if (hydrating) {
      nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
        if (unmounted) return
        system.reducedMotion = mode
        system.start()
      })
    } else if (import.meta.client) {
      system.start()
    }
  })
})`
}

/**
 * The Nuxt module. It creates one spring system for the app, starts it
 * on the client only, so server rendering shows springs at their initial
 * values, and disposes it when the app unmounts. The module auto-imports
 * `useSpring`, `useRamp`, `useSpringSystem`, `useSpringPool`,
 * `defineSpring`, `mapSpring`, `velocityOf`, `accelerationOf`, and
 * `targetOf`, and registers the `SpringValue` component. It does not
 * auto-import types.
 */
const coilyModule: NuxtModule = defineNuxtModule<CoilyModuleOptions>({
  meta: {
    name: 'coily',
    configKey: 'coily',
  },
  defaults: {
    debug: false,
  },
  async setup(_options) {
    addPluginTemplate({
      name: 'coily',
      filename: 'coily.plugin.mjs',
      mode: 'all',
      getContents: () => getPluginTemplate(_options),
    })

    // Values only. Most apps never name the types, and editors import them
    // on demand.
    addImports([
      { from: 'coily/vue', name: 'useSpring' },
      { from: 'coily/vue', name: 'useRamp' },
      { from: 'coily/vue', name: 'useSpringSystem' },
      { from: 'coily/vue', name: 'useSpringPool' },
      { from: 'coily', name: 'defineSpring' },
      { from: 'coily', name: 'mapSpring' },
      { from: 'coily', name: 'velocityOf' },
      { from: 'coily', name: 'accelerationOf' },
      { from: 'coily', name: 'targetOf' },
    ])

    addComponent({
      name: 'SpringValue',
      filePath: 'coily/vue',
      export: 'SpringValue',
      chunkName: 'placement',
    })
  },
})

export { coilyModule as default }
