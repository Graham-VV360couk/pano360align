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

import type { RenderParams } from "./equirect";

/**
 * Inverse of the renderer's per-pixel forward transform: given a screen
 * pixel and the current view parameters, return the world (yaw, pitch)
 * that pixel is sampling. Roll is applied as a screen-plane rotation
 * BEFORE yaw and pitch (matching renderEquirect order).
 */
export function screenToSpherical(
  sx: number,
  sy: number,
  W: number,
  H: number,
  view: RenderParams
): { yaw: number; pitch: number } {
  const fovRad = (view.fov * Math.PI) / 180;
  const halfFovH = fovRad / 2;
  const halfFovV = (fovRad * H) / W / 2;
  const yR = (view.yaw * Math.PI) / 180;
  const pR = (view.pitch * Math.PI) / 180;
  const rR = (view.roll * Math.PI) / 180;

  const angH = -halfFovH + (sx / W) * 2 * halfFovH;
  const angV = halfFovV - (sy / H) * 2 * halfFovV;

  let dx = Math.sin(angH);
  let dy = Math.sin(angV) * Math.cos(angH);
  const dz = Math.cos(angH) * Math.cos(angV);

  const cosR = Math.cos(rR), sinR = Math.sin(rR);
  const rdx = dx * cosR - dy * sinR;
  const rdy = dx * sinR + dy * cosR;
  dx = rdx;
  dy = rdy;

  const cosY = Math.cos(yR), sinY = Math.sin(yR);
  const rx = dx * cosY + dz * sinY;
  const ry = dy;
  const rz = -dx * sinY + dz * cosY;

  const cosP = Math.cos(pR), sinP = Math.sin(pR);
  const fx = rx;
  const fy = ry * cosP - rz * sinP;
  const fz = ry * sinP + rz * cosP;

  const lat = Math.asin(Math.max(-1, Math.min(1, fy)));
  const lon = Math.atan2(fx, fz);
  return {
    yaw: (lon * 180) / Math.PI,
    pitch: (lat * 180) / Math.PI,
  };
}

/**
 * Forward direction: project a world (yaw, pitch) back to a screen pixel
 * for the given view parameters. Returns visible=false when the point
 * is behind the view or outside the frustum.
 */
export function projectSphericalToScreen(
  worldYawDeg: number,
  worldPitchDeg: number,
  W: number,
  H: number,
  view: RenderParams
): { x: number; y: number; visible: boolean } {
  const fovRad = (view.fov * Math.PI) / 180;
  const halfFovH = fovRad / 2;
  const halfFovV = (fovRad * H) / W / 2;

  const lat = (worldPitchDeg * Math.PI) / 180;
  const lon = (worldYawDeg * Math.PI) / 180;
  const wx = Math.cos(lat) * Math.sin(lon);
  const wy = Math.sin(lat);
  const wz = Math.cos(lat) * Math.cos(lon);

  const yR = (view.yaw * Math.PI) / 180;
  const pR = (view.pitch * Math.PI) / 180;
  const rR = (view.roll * Math.PI) / 180;

  const cosP = Math.cos(pR), sinP = Math.sin(pR);
  const py = wy * cosP + wz * sinP;
  const pz = -wy * sinP + wz * cosP;
  let dx = wx;
  let dy = py;
  let dz = pz;

  const cosY = Math.cos(yR), sinY = Math.sin(yR);
  const ix = dx * cosY - dz * sinY;
  const iz = dx * sinY + dz * cosY;
  dx = ix;
  dz = iz;

  const cosR = Math.cos(rR), sinR = Math.sin(rR);
  const rdx = dx * cosR + dy * sinR;
  const rdy = -dx * sinR + dy * cosR;
  dx = rdx;
  dy = rdy;

  if (dz <= 0.0001) return { x: 0, y: 0, visible: false };

  const angH = Math.atan2(dx, dz);
  const cosAngH = Math.cos(angH);
  if (Math.abs(cosAngH) < 1e-9) return { x: 0, y: 0, visible: false };
  const sinAngV = dy / cosAngH;
  if (sinAngV < -1 || sinAngV > 1) return { x: 0, y: 0, visible: false };
  const angV = Math.asin(sinAngV);

  if (Math.abs(angH) > halfFovH || Math.abs(angV) > halfFovV) {
    return { x: 0, y: 0, visible: false };
  }

  const x = ((angH + halfFovH) / (2 * halfFovH)) * W;
  const y = ((halfFovV - angV) / (2 * halfFovV)) * H;
  return { x, y, visible: true };
}

/**
 * Shortest distance from a point to a finite line segment, in the same
 * units as the inputs (pixels). Used to hit-test clicks against drawn
 * lines on the overlay canvas.
 */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * A reference line stored in world (spherical) coordinates so it remains
 * anchored to the underlying scene as the user pans. The `derivedRoll`
 * is computed at draw time from the screen-space angle and frozen for
 * the line's lifetime.
 */
export interface ReferenceLine {
  id: number;
  orientation: LineOrientation;
  a: { yaw: number; pitch: number };
  b: { yaw: number; pitch: number };
  derivedRoll: number;
}
