import { describe, it, expect } from "vitest";
import { derivedRollFromScreenAngle, averageRoll } from "./lineMath";

describe("derivedRollFromScreenAngle", () => {
  it("returns 0 for a perfectly level horizontal line", () => {
    expect(derivedRollFromScreenAngle(0, "horizontal")).toBeCloseTo(0);
  });

  it("normalises a right-to-left horizontal line (~180°) to ~0°", () => {
    expect(derivedRollFromScreenAngle(180, "horizontal")).toBeCloseTo(0);
    expect(derivedRollFromScreenAngle(-180, "horizontal")).toBeCloseTo(0);
  });

  it("returns -5 for a horizontal line tilted +5° clockwise on screen", () => {
    expect(derivedRollFromScreenAngle(5, "horizontal")).toBeCloseTo(-5);
  });

  it("returns 0 for a perfectly plumb vertical line drawn top-to-bottom (~+90°)", () => {
    expect(derivedRollFromScreenAngle(90, "vertical")).toBeCloseTo(0);
  });

  it("returns 0 for a perfectly plumb vertical line drawn bottom-to-top (~-90°)", () => {
    expect(derivedRollFromScreenAngle(-90, "vertical")).toBeCloseTo(0);
  });

  it("returns -3 for a vertical line tilted 3° from plumb", () => {
    // -90 + 3 = -87  →  derivedRoll = -(-87 + 90) = -3
    expect(derivedRollFromScreenAngle(-87, "vertical")).toBeCloseTo(-3);
  });
});

describe("averageRoll", () => {
  it("returns 0 for an empty array", () => {
    expect(averageRoll([])).toBe(0);
  });

  it("returns the single value for one entry", () => {
    expect(averageRoll([2.5])).toBeCloseTo(2.5);
  });

  it("averages multiple values", () => {
    expect(averageRoll([-3, -2, -4])).toBeCloseTo(-3);
  });
});

import { screenToSpherical, projectSphericalToScreen } from "./lineMath";

describe("screenToSpherical / projectSphericalToScreen — round trip", () => {
  const view = { yaw: 0, pitch: 0, roll: 0, fov: 100 };
  const W = 800, H = 450;

  it("centre pixel maps to (yaw=0, pitch=0) at zero rotation", () => {
    const sph = screenToSpherical(W / 2, H / 2, W, H, view);
    expect(sph.yaw).toBeCloseTo(0, 1);
    expect(sph.pitch).toBeCloseTo(0, 1);
  });

  it("round-trips a non-centre pixel", () => {
    const sx = 600, sy = 200;
    const sph = screenToSpherical(sx, sy, W, H, view);
    const back = projectSphericalToScreen(sph.yaw, sph.pitch, W, H, view);
    expect(back.visible).toBe(true);
    expect(back.x).toBeCloseTo(sx, 0);
    expect(back.y).toBeCloseTo(sy, 0);
  });

  it("reports points behind the view as not visible", () => {
    const back = projectSphericalToScreen(180, 0, W, H, view);
    expect(back.visible).toBe(false);
  });

  it("round-trips after a yaw rotation", () => {
    const rotated = { yaw: 30, pitch: 0, roll: 0, fov: 100 };
    const sph = screenToSpherical(500, 220, W, H, rotated);
    const back = projectSphericalToScreen(sph.yaw, sph.pitch, W, H, rotated);
    expect(back.visible).toBe(true);
    expect(back.x).toBeCloseTo(500, 0);
    expect(back.y).toBeCloseTo(220, 0);
  });

  it("round-trips after a roll rotation", () => {
    const rolled = { yaw: 0, pitch: 0, roll: 5, fov: 100 };
    const sph = screenToSpherical(450, 240, W, H, rolled);
    const back = projectSphericalToScreen(sph.yaw, sph.pitch, W, H, rolled);
    expect(back.visible).toBe(true);
    expect(back.x).toBeCloseTo(450, 0);
    expect(back.y).toBeCloseTo(240, 0);
  });
});

import { distanceToSegment } from "./lineMath";

describe("distanceToSegment", () => {
  it("returns 0 for a point on the segment", () => {
    expect(distanceToSegment(50, 50, 0, 0, 100, 100)).toBeCloseTo(0);
  });

  it("returns perpendicular distance to the segment line", () => {
    expect(distanceToSegment(0, 10, 0, 0, 100, 0)).toBeCloseTo(10);
  });

  it("returns distance to the nearest endpoint when past the end", () => {
    expect(distanceToSegment(110, 0, 0, 0, 100, 0)).toBeCloseTo(10);
    expect(distanceToSegment(-10, 0, 0, 0, 100, 0)).toBeCloseTo(10);
  });

  it("handles zero-length segments by returning distance to the point", () => {
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
});
