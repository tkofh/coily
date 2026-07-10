import { addComponent, addImports, addPluginTemplate, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export interface CoilyModuleOptions {
  debug?: boolean
  /** How the spring system responds to `prefers-reduced-motion`. @default 'user' */
  reducedMotion?: 'user' | 'always' | 'never'
}

function getPluginTemplate(options: CoilyModuleOptions) {
  const systemOptions: Record<string, unknown> = {}
  if (options.debug) systemOptions.debug = true
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
      { from: 'coily/vue', name: 'SpringObjectRef', type: true },
      { from: 'coily/vue', name: 'SpringPool', type: true },
      { from: 'coily', name: 'defineSpring' },
      { from: 'coily', name: 'SpringConfig', type: true },
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
