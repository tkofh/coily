import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  rollup: {
    esbuild: {
      target: 'esnext',
    },
  },
})
