export {
  createSpringSystem,
  type SpringSystem,
  type SpringSystemOptions,
  type SpringOptions,
  type CompositeSpringOptions,
} from './system.ts'
export type { Spring, SpringTarget, Purpose } from './spring.ts'
export {
  mapSpring,
  type SourceShape,
  type SourceValues,
  type SpringSource,
  type SpringSourceApi,
  SpringSourceSymbol,
} from './spring-source.ts'
export {
  velocityOf,
  accelerationOf,
  type KinematicSource,
  type KinematicSourceApi,
} from './kinematic-source.ts'
export type {
  ConfigShape,
  PurposeShape,
  PartialShape,
  ReadonlyShape,
  Shape,
  TargetShape,
  CompositeSpring,
  CompositeSpringTarget,
} from './composite-spring.ts'
export {
  type SpringDefinition,
  type SpringState,
  defineSpring,
  type SpringDefinitionOptions,
} from './config.ts'
export type { TickerOptions } from './ticker.ts'
