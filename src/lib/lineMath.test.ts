import { describe, it, expect } from "vitest";
import { derivedRollFromScreenAngle } from "./lineMath";

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
