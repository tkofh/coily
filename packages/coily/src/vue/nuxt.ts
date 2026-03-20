import { addComponent, addImports, addPluginTemplate, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

const pluginTemplate = `import { createSpringSystem } from 'coily'
import { provideSpringSystem } from 'coily/vue'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:created', (vueApp) => {
    const system = createSpringSystem()
    provideSpringSystem(system, vueApp)

    if(import.meta.client) {
      system.start()
    }
  })
})`

const coilyModule: NuxtModule = defineNuxtModule({
  meta: {
    name: 'coily',
    configKey: 'coily',
  },
  async setup() {
    addPluginTemplate({
      name: 'coily',
      filename: 'coily.plugin.mjs',
      mode: 'all',
      getContents: () => pluginTemplate,
    })

    addImports([
      { from: 'coily/vue', name: 'useSpring' },
      { from: 'coily/vue', name: 'SpringRef', type: true },
      { from: 'coily/vue', name: 'LinkedSpringRef', type: true },
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
