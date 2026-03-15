import { defineConfig } from 'tsdown'

export default defineConfig({
  dts: true,
  entry: {
    index: 'src/index.ts',
    loop: 'src/loop.ts',
    vue: 'src/vue/index.ts',
    nuxt: 'src/vue/nuxt.ts',
  },
  platform: 'neutral',
  format: 'esm',
  exports: true,
  clean: true,
  deps: {
    neverBundle: ['vue', '@nuxt/kit', '@nuxt/schema'],
  },
})
