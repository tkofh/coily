import {
  type Annotation,
  type AnnotationContext,
  ShapeNode,
  ShapeView,
  isRecordOrArray,
} from './shape-node.ts'
import { invariant } from './util.ts'

export { ShapeView, describePath, isRecord, isRecordOrArray } from './shape-node.ts'
export type { Annotation, AnnotationContext } from './shape-node.ts'

/**
 * A numeric shape — a plain object or array whose leaves are all numbers —
 * flattened into one leaf object per number, with the nesting preserved as a
 * tree of `ShapeNode`s. The shape is fixed at construction. Knows nothing
 * about what the leaves are: construction, views, partial application,
 * zipping two maps, and annotation shapes are all structural; leaf semantics
 * live with the caller. Paths appear as dot-joined strings (`position.x`,
 * `color.2`) in every error.
 */
export class ShapeMap<L> {
  readonly #root: ShapeNode<L>
  readonly #leaves: L[] = []

  constructor(shape: object, factory: (value: number, path: string) => L) {
    invariant(
      isRecordOrArray(shape),
      'A shape must be a plain object or an array of numeric channels',
    )
    this.#root = ShapeNode.build(shape, '', factory, this.#leaves)
  }

  /** Every leaf in depth-first shape order. */
  get leaves(): readonly L[] {
    return this.#leaves
  }

  /**
   * Builds a live mirror of the shape with `read(leaf)` at every leaf —
   * see `ShapeView`.
   */
  createView(read: (leaf: L) => number): ShapeView<L> {
    return new ShapeView(this.#root, read)
  }

  /**
   * Applies a partial numeric shape: `apply` runs for each channel the input
   * mentions, the rest are untouched. Unknown channels and structure
   * mismatches throw; `undefined` entries (and array holes) are skipped.
   */
  applyPartial(input: unknown, apply: (leaf: L, value: number) => void): void {
    this.#root.applyPartial(input, '', apply)
  }

  /**
   * Pairs this map's leaves with another map's, requiring the shapes to
   * match exactly. `values` is an optional partial numeric shape (labelled
   * `valuesLabel` in errors) delivered alongside each pair — absent entries
   * arrive as `undefined`.
   */
  zip(
    other: ShapeMap<L>,
    values: unknown,
    valuesLabel: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void {
    this.#root.zip(other.#root, values, '', { fn, label: valuesLabel })
  }

  /**
   * Applies an annotation shape — an input mirroring the shape where a value
   * at any node covers every leaf below it. At each node, `resolve` decides
   * whether the input is a value for the whole subtree or a branch to
   * descend into; `apply` runs per covered leaf. `undefined` entries are
   * skipped, unknown channels (labelled `label` in errors) throw.
   */
  applyAnnotation<V>(
    input: unknown,
    resolve: (input: unknown, context: AnnotationContext, path: string) => Annotation<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void {
    if (input === undefined) return
    this.#root.annotate(input, '', { resolve, apply, label })
  }
}
