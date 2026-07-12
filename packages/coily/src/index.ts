export { createSpringSystem, type SpringSystem, type SpringSystemOptions } from './system.ts'
export type { Spring, SpringTarget } from './spring.ts'
export {
  mapSpring,
  type SourceShape,
  type SourceValues,
  type SpringSource,
  SpringSourceSymbol,
} from './spring-source.ts'
export type {
  ConfigShape,
  PartialShape,
  ReadonlyShape,
  Shape,
  SpringObject,
  SpringObjectTarget,
} from './spring-object.ts'
export {
  type SpringDefinition,
  type SpringState,
  defineSpring,
  type SpringDefinitionOptions,
} from './config.ts'
export type { TickerOptions } from './ticker.ts'
