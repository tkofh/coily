export {
  createSpringSystem,
  type SpringSystem,
  type SpringSystemOptions,
  type SpringOptions,
  type CompositeSpringOptions,
  type ReducedMotionMode,
} from './system.ts'
export type { Spring, SpringTarget, Purpose } from './spring.ts'
export type { Ramp, RampOptions } from './ramp.ts'
export {
  mapSpring,
  type SpringSource,
  type SpringSourceApi,
  type SourceShape,
  type SourceValues,
  SpringSourceSymbol,
} from './spring-source.ts'
export {
  velocityOf,
  accelerationOf,
  targetOf,
  type KinematicSource,
  type KinematicSourceApi,
  type TargetedSource,
  type TargetedSourceApi,
} from './kinematic-source.ts'
export type {
  Shape,
  PartialShape,
  ReadonlyShape,
  TargetShape,
  ConfigShape,
  PurposeShape,
  CompositeSpring,
  CompositeSpringTarget,
} from './composite-spring.ts'
export {
  SpringDefinition,
  type SpringState,
  defineSpring,
  type SpringDefinitionOptions,
} from './config.ts'
