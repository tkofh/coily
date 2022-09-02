import type {
  SpringConfig,
  SpringChainLinkGetter,
  SpringOptions,
  StandaloneSpringChain,
} from './types'
import { createSpringChainImpl } from './lib'

export const createSpringChain = (
  initial: number,
  links: SpringChainLinkGetter[],
  config: SpringConfig,
  options?: SpringOptions
): StandaloneSpringChain => {
  const [chain, simulate] = createSpringChainImpl(initial, links, config, options)
  return Object.assign(chain, { simulate })
}
