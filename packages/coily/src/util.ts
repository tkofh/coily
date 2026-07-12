export function invariant(
  condition: unknown,
  message?: string | (() => string),
): asserts condition {
  if (condition) {
    return
  }
  const resolved = typeof message === 'function' ? message() : message
  throw new Error(resolved ?? 'Invariant Failed')
}

/**
 * True for plain objects only. Class instances are excluded so shape
 * walks reject values like a `Spring` instead of descending into their
 * fields as if they were nested shapes.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export function isRecordOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value)
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}
