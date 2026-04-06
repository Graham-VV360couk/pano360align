/**
 * Pure math helpers for the reference-line tool.
 *
 * Ported (and simplified) from EquiRecover/src/alignment/compute.js.
 * Drops front/rear zone separation and statistical warnings — we only
 * need a single averaged roll value.
 */

export type LineOrientation = "horizontal" | "vertical";

/**
 * Compute the roll contribution of a single drawn line, given the screen
 * angle (degrees, atan2 convention) and the line's orientation.
 *
 * Horizontal: a perfectly level line (angle 0°) returns 0.
 * Vertical:   a perfectly plumb line (angle ±90°) returns 0.
 *
 * The result is the roll that, when applied to the view, would rotate
 * the line into its canonical orientation.
 */
export function derivedRollFromScreenAngle(
  angleDeg: number,
  orientation: LineOrientation
): number {
  let angle = angleDeg;

  if (orientation === "horizontal") {
    // Normalise: lines drawn right-to-left have angles near ±180°.
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return -angle;
  }

  // Vertical: top-to-bottom is ~+90°, bottom-to-top is ~-90°.
  // Normalise both to near -90°.
  if (angle > 0) angle -= 180;
  return -(angle + 90);
}

/**
 * Average a list of derived roll values. Returns 0 for an empty list
 * (caller should treat that as "no correction").
 */
export function averageRoll(rolls: number[]): number {
  if (rolls.length === 0) return 0;
  let sum = 0;
  for (const r of rolls) sum += r;
  return sum / rolls.length;
}
