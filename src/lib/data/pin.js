/**
 * Shared PIN rules — one source of truth for adapters and UI.
 *
 * Kept deliberately small: factory workers set a numeric PIN, so the policy is
 * length + digits-only + a weak-value guard, not full password complexity.
 */
export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PIN_COST = 10; // bcrypt cost factor

// A few trivially-guessable PINs to reject outright.
const WEAK_PINS = new Set(['0000', '1234', '1111', '123456', '000000', '654321']);

/**
 * Returns null if `pin` is acceptable, otherwise a user-facing reason string.
 * Use for inline UI validation without throwing.
 */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) return 'PIN must be numbers only.';
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return `PIN must be ${PIN_MIN}–${PIN_MAX} digits.`;
  }
  if (WEAK_PINS.has(pin)) return 'That PIN is too easy to guess. Pick another.';
  return null;
}

/** Throws Error(reason) if the PIN is unacceptable. Used by the data layer. */
export function assertValidPin(pin) {
  const problem = pinProblem(pin);
  if (problem) throw new Error(problem);
}
