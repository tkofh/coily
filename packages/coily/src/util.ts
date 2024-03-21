export function invariant(
  condition: unknown,
  message?: string,
): asserts condition {
  if (condition) {
    return
  }
  throw new Error(message ?? 'Invariant Failed')
}

export function roundTo(value: number, precision: number) {
  const p = 10 ** precision
  return Math.round(value * p) / p
}
