import { Motion } from './motion.ts'
import { recipeOf } from './spring-source.ts'

// What advances a registered source: its own motion, or the sources it
// aggregates (a composite's channels), each resolved through its own
// entry. Constructors write it; `resolveLeaderMotions` reads it. A
// source with no entry is foreign — a user-authored object honoring the
// `SpringSource` contract — and contributes no ordering constraint.
const MOTION_BACKING = new WeakMap<object, Motion | readonly object[]>()

/**
 * Records what advances `source`: its own `Motion` for a scalar spring,
 * or the aggregated sources whose own registrations lead to motions (a
 * composite registers its channel springs). Called once per source, from
 * the `Spring` and `CompositeSpring` constructors.
 */
export function registerBacking(source: object, backing: Motion | readonly object[]): void {
  MOTION_BACKING.set(source, backing)
}

/**
 * Resolves the motions behind `source`, deduplicated: every spring
 * reached through any chain of derivations — `mapSpring` pipelines,
 * `velocityOf`/`accelerationOf` wrappers, composite channels. A foreign
 * source resolves to nothing: it imposes no tick-ordering constraint and
 * couples through its emitter alone.
 */
export function resolveLeaderMotions(source: object): readonly Motion[] {
  const leaders = new Set<Motion>()
  collectInto(source, leaders)
  return [...leaders]
}

// Recipe roots and backings only reference sources created before their
// owner, so the walk follows creation order and cannot cycle.
function collectInto(source: object, leaders: Set<Motion>): void {
  const recipe = recipeOf(source)
  if (recipe) {
    for (const root of recipe.sources) collectInto(root, leaders)
    return
  }
  const backing = MOTION_BACKING.get(source)
  if (backing === undefined) return
  if (backing instanceof Motion) {
    leaders.add(backing)
  } else {
    for (const part of backing) collectInto(part, leaders)
  }
}
