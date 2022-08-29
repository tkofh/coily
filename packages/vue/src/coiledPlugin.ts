import type { Plugin } from 'vue'
import type { SpringSystem } from 'coiled'
import { createSpringSystem } from 'coiled'
import { SPRING_SYSTEM } from './injections'

interface CoiledPluginOptions {
  system?: SpringSystem
}

export const coiledPlugin: Plugin = {
  install: (app, options?: CoiledPluginOptions) => {
    const system = options != null && 'system' in options ? options.system : createSpringSystem()

    app.provide(SPRING_SYSTEM, system)
  },
}
