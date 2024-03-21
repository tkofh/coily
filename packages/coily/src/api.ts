import { SpringSystem } from './system'

export type { SpringSystem } from './system'
export type { Spring } from './spring'

export function createSpringSystem() {
  return new SpringSystem()
}
