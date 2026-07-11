import { type Coverage, ChannelTreeNode, ChannelView } from './channel-tree-node.ts'
import { invariant, isRecordOrArray } from './util.ts'

export { BRANCH, ChannelView, describePath } from './channel-tree-node.ts'
export type { Coverage } from './channel-tree-node.ts'

/**
 * A numeric shape — a plain object or array whose leaves are all numbers —
 * flattened into one leaf object per number, with the nesting preserved as a
 * tree of `ChannelTreeNode`s. The shape is fixed at construction. Knows nothing
 * about what the leaves are: construction, views, scatter, zip, and
 * broadcast are all structural; leaf semantics
 * live with the caller. Paths appear as dot-joined strings (`position.x`,
 * `color.2`) in every error.
 */
export class ChannelTree<L> {
  readonly #root: ChannelTreeNode<L>
  readonly #leaves: L[] = []

  constructor(shape: object, factory: (value: number, path: string) => L) {
    invariant(
      isRecordOrArray(shape),
      'A shape must be a plain object or an array of numeric channels',
    )
    this.#root = ChannelTreeNode.build(shape, '', factory, this.#leaves)
  }

  /** Every leaf in depth-first shape order. */
  get leaves(): readonly L[] {
    return this.#leaves
  }

  /**
   * Builds a live view of the shape with `read(leaf)` at every leaf —
   * see `ChannelView`.
   */
  createView(read: (leaf: L) => number): ChannelView<L> {
    return new ChannelView(this.#root, read)
  }

  /**
   * Scatters a partial numeric shape: `apply` runs for each channel the input
   * mentions, the rest are untouched. Unknown channels and structure
   * mismatches throw; `undefined` entries (and array holes) are skipped.
   */
  scatter(input: unknown, apply: (leaf: L, value: number) => void): void {
    this.#root.scatter(input, apply)
  }

  /**
   * Pairs this map's leaves with another map's, requiring the shapes to
   * match exactly. `values` is an optional partial numeric shape (labelled
   * `valuesLabel` in errors) delivered alongside each pair — absent entries
   * arrive as `undefined`.
   */
  zip(
    other: ChannelTree<L>,
    values: unknown,
    valuesLabel: string,
    fn: (mine: L, theirs: L, value: number | undefined, path: string) => void,
  ): void {
    this.#root.zip(other.#root, values, { fn, label: valuesLabel })
  }

  /**
   * Broadcasts a covering shape — an input mirroring the shape where a value
   * at any node covers every leaf below it. At each node, `resolve` decides
   * whether the input is a value for the whole subtree or a branch to
   * descend into; `apply` runs per covered leaf. `undefined` entries are
   * skipped, unknown channels (labelled `label` in errors) throw.
   */
  broadcast<V>(
    input: unknown,
    resolve: (input: unknown, path: string) => Coverage<V>,
    apply: (leaf: L, value: V) => void,
    label: string,
  ): void {
    if (input === undefined) return
    this.#root.broadcast(input, { resolve, apply, label })
  }
}
