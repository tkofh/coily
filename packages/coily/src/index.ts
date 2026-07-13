export {
  createSpringSystem,
  type SpringSystem,
  type SpringSystemOptions,
  type SpringOptions,
  type CompositeSpringOptions,
} from './system.ts'
export type { Spring, SpringTarget, Purpose } from './spring.ts'
export { mapSpring, type SpringSource, SpringSourceSymbol } from './spring-source.ts'
export { velocityOf, accelerationOf, type KinematicSource } from './kinematic-source.ts'
export type {
  ConfigShape,
  PurposeShape,
  CompositeSpring,
  CompositeSpringTarget,
} from './composite-spring.ts'
export {
  type SpringDefinition,
  type SpringState,
  defineSpring,
  type SpringDefinitionOptions,
} from './config.ts'
