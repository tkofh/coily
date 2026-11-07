import { addComponent, addImports, addPluginTemplate, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

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
   * The frame gap in ms above which the system treats the gap as lag. The
   * system replaces a lag gap with `adjustedLag`, so springs do not jump
   * when frames resume. 0 turns off lag clamping.
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
   * the value's own units. The system splits a frame whose motion would
   * exceed it into internal sub-steps. A smaller value follows more
   * closely and costs more solver work.
   * @default 0.1
   */
  couplingTolerance?: number
  /**
   * When springs snap to their targets instead of animating. `'user'`
   * follows the OS prefers-reduced-motion setting, including live
   * changes. `'always'` and `'never'` force one behavior.
   * @default 'user'
   */
  reducedMotion?: 'user' | 'always' | 'never'
}

function getPluginTemplate(options: CoilyModuleOptions) {
  const systemOptions: Record<string, unknown> = {}
  if (options.debug) systemOptions.debug = true
  if (options.fps !== undefined) systemOptions.fps = options.fps
  if (options.lagThreshold !== undefined) systemOptions.lagThreshold = options.lagThreshold
  if (options.adjustedLag !== undefined) systemOptions.adjustedLag = options.adjustedLag
  if (options.couplingTolerance !== undefined)
    systemOptions.couplingTolerance = options.couplingTolerance
  if (options.reducedMotion) systemOptions.reducedMotion = options.reducedMotion

  const args = Object.keys(systemOptions).length > 0 ? JSON.stringify(systemOptions) : ''

  return `import { createSpringSystem } from 'coily'
import { provideSpringSystem } from 'coily/vue'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:created', (vueApp) => {
    const system = createSpringSystem(${args})
    provideSpringSystem(system, vueApp)

    if(import.meta.client) {
      system.start()
    }
  })
})`
}

/**
 * The Nuxt module. It creates one spring system for the app and starts
 * it on the client only. On the server the system never starts, so
 * springs render their initial values. The module auto-imports
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
