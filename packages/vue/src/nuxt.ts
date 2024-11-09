import {
  addComponent,
  addImports,
  addPluginTemplate,
  defineNuxtModule,
} from '@nuxt/kit' // @ts-ignore
import {} from '@nuxt/schema'

const pluginTemplate = `import { createSpringSystem } from 'coily'
import { start } from 'coily/loop'
import { provideSpringSystem } from '@coily/vue/system'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:created', (vueApp) => {
    const system = createSpringSystem()
    provideSpringSystem(system, vueApp)
    
    if(import.meta.client) {
      start(system)
    }
  })
})`

// biome-ignore lint/style/noDefaultExport: nuxt requires a default export
export default defineNuxtModule({
  meta: {
    name: '@coily/vue',
    configKey: 'coily',
  },
  async setup() {
    addPluginTemplate({
      name: '@coily/vue',
      filename: 'coily.plugin.mjs',
      mode: 'all',
      // write: true,
      getContents: () => pluginTemplate,
    })

    addImports({
      from: '@coily/vue',
      name: 'useSpring',
    })

    await addComponent({
      name: 'SpringValue',
      filePath: '@coily/vue/component',
      export: 'SpringValue',
      chunkName: 'placement',
    })
  },
})
