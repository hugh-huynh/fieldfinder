// CANARY for the codex-autofix workflow (do not merge). This file exists only so Codex has something
// to review; the PR is closed once the autofix loop has been observed end to end.

/**
 * Restricts `value` to the inclusive range [min, max]: values below `min` become `min`, values above
 * `max` become `max`, and values inside the range are returned unchanged.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
