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
   * Frame-rate cap. 0 means uncapped: one tick per displayed frame.
   * Capped ticks land on whole display frames and receive the true
   * elapsed time.
   * @default 0
   */
  fps?: number
  /**
   * Frame gap in milliseconds above which the gap is treated as lag and
   * replaced with `adjustedLag`, so springs don't teleport when frames
   * resume. 0 disables lag clamping.
   * @default 500
   */
  lagThreshold?: number
  /**
   * The elapsed milliseconds a lagging frame is replaced with. Clamped
   * to at most `lagThreshold`.
   * @default 33
   */
  adjustedLag?: number
  /**
   * When springs snap to their targets instead of animating: `'user'`
   * follows the OS prefers-reduced-motion setting, including live
   * changes; `'always'` and `'never'` force one behavior.
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
 * The Nuxt module: creates an app-wide spring system (started on the
 * client), auto-imports `useSpring`, `useSpringSystem`, `useSpringPool`,
 * `defineSpring`, and `mapSpring`, and registers the `SpringValue`
 * component.
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

    addImports([
      { from: 'coily/vue', name: 'useSpring' },
      { from: 'coily/vue', name: 'useSpringSystem' },
      { from: 'coily/vue', name: 'useSpringPool' },
      { from: 'coily/vue', name: 'SpringRef', type: true },
      { from: 'coily/vue', name: 'CompositeSpringRef', type: true },
      { from: 'coily/vue', name: 'SpringPool', type: true },
      { from: 'coily', name: 'defineSpring' },
      { from: 'coily', name: 'mapSpring' },
      { from: 'coily', name: 'SpringDefinition', type: true },
      { from: 'coily', name: 'SpringSource', type: true },
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
