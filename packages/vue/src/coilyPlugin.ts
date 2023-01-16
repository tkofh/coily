import type { Plugin } from 'vue'
import type { SpringSystem } from 'coily'
import { createSpringSystem } from 'coily'
import { SPRING_SYSTEM } from './injections'

interface CoilyPluginOptions {
  system?: SpringSystem
}

export const createCoilyPlugin = (options?: CoilyPluginOptions): Plugin => ({
  install: (app) => {
    const system = options != null && 'system' in options ? options.system : createSpringSystem()

    app.provide(SPRING_SYSTEM, system)
  },
})
