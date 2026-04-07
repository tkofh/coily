export interface Vector2 {
  x: number
  y: number
}

export function isVector2(value: unknown): value is Vector2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof (value as Vector2).x === 'number'
  )
}
