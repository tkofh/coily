export function invariant(condition: unknown, message?: string): asserts condition {
  if (condition) {
    return
  }
  throw new Error(message ?? 'Invariant Failed')
}

interface SettlingTimeOptions {
  mass: number
  tension: number
  damping: number
  /** Displacement from target (value - target). */
  displacement: number
  /** Initial velocity. Defaults to 0. */
  velocity?: number
  /** Precision for resting threshold. Defaults to 2. */
  precision?: number
}

/**
 * Analytically estimates the time for a damped spring to come to rest.
 *
 * Uses the exponential decay envelope common to all three damping regimes.
 * The decay rate depends on the regime:
 * - Underdamped (ζ < 1): σ = ζωₙ
 * - Critically damped (ζ = 1): σ = ωₙ
 * - Overdamped (ζ > 1): σ = (ζ - √(ζ²-1))ωₙ  (the slower eigenvalue)
 *
 * The effective initial amplitude accounts for both displacement and velocity,
 * since kinetic energy can convert to additional displacement:
 *   A₀ = |x₀| + |v₀| / ωₙ
 *
 * Settling time: t = ln(A₀ / threshold) / σ, with a 2× safety factor
 * to account for polynomial terms in the critically damped solution.
 */
export function settlingTime(options: SettlingTimeOptions): number {
  const { mass, tension, damping, displacement, velocity = 0, precision = 2 } = options

  const threshold = 1 / 10 ** precision
  const wn = Math.sqrt(tension / mass)
  const cc = 2 * mass * wn
  const zeta = damping / cc

  // Effective initial amplitude: displacement + velocity converted to displacement
  const a0 = Math.abs(displacement) + Math.abs(velocity) / wn

  if (a0 <= threshold) return 0

  // Decay rate depends on damping regime
  let sigma: number
  if (zeta < 1) {
    sigma = zeta * wn
  } else if (zeta === 1) {
    sigma = wn
  } else {
    // Overdamped: slower eigenvalue
    sigma = (zeta - Math.sqrt(zeta * zeta - 1)) * wn
  }

  if (sigma <= 0) return Infinity

  return 2 * Math.log(a0 / threshold) / sigma
}
