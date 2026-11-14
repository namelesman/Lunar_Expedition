import { describe, expect, it } from "vitest";
import {
  bodyPositionAt,
  diskFractionAbove,
  horizonElevationAt,
  moonSkyState,
  type HorizonMask,
} from "../src";

/**
 * Reference values from JPL Horizons (DE441), observer "coord@301" (geodetic on
 * the 1737.4 km sphere), QUANTITIES=4, APPARENT=AIRLESS, 2026-11-14 18:00 UTC.
 * https://ssd.jpl.nasa.gov/api/horizons.api — queried 2026-11-14.
 */
const T = Date.UTC(2026, 10, 14, 18, 0, 0);
const CASES = [
  {
    name: "Apollo 11",
    lat: 0.67416,
    lon: 23.47314,
    sun: [91.51373, -4.021455],
    earth: [276.860022, 64.0027],
    azTol: 0.02,
  },
  {
    name: "IM-1 Malapert A",
    lat: -80.13,
    lon: 1.44,
    sun: [115.942666, -2.777323],
    earth: [356.273184, 6.008074],
    azTol: 0.02,
  },
  {
    name: "Near Shackleton rim",
    lat: -89.45,
    lon: -137.31,
    sun: [254.773559, 1.412126],
    earth: [135.012299, -4.231001],
    azTol: 0.05,
  },
] as const;

function angDiff(a: number, b: number) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

describe("Sun / Earth positions vs JPL Horizons", () => {
  const sky = moonSkyState(T);
  for (const c of CASES) {
    it(`${c.name}: Sun az/el`, () => {
      const p = bodyPositionAt("sun", c, sky);
      expect(angDiff(p.azimuthDeg, c.sun[0])).toBeLessThan(c.azTol);
      expect(Math.abs(p.elevationDeg - c.sun[1])).toBeLessThan(0.01);
    });
    it(`${c.name}: Earth az/el`, () => {
      const p = bodyPositionAt("earth", c, sky);
      expect(angDiff(p.azimuthDeg, c.earth[0])).toBeLessThan(c.azTol);
      expect(Math.abs(p.elevationDeg - c.earth[1])).toBeLessThan(0.01);
    });
  }

  it("Sun and Earth disks have the expected apparent size", () => {
    const sun = bodyPositionAt("sun", CASES[0], sky);
    const earth = bodyPositionAt("earth", CASES[0], sky);
    expect(sun.angularRadiusDeg).toBeGreaterThan(0.26);
    expect(sun.angularRadiusDeg).toBeLessThan(0.28);
    expect(earth.angularRadiusDeg).toBeGreaterThan(0.9);
    expect(earth.angularRadiusDeg).toBeLessThan(1.0);
  });
});

describe("terrain horizon helpers", () => {
  const mask: HorizonMask = {
    siteId: "t",
    lat: 0,
    lon: 0,
    observerHeightM: 2,
    siteElevationM: 0,
    azimuthStepDeg: 90,
    elevationsDeg: [0, 2, 4, 2],
    maxDistanceKm: 100,
    demSource: "test",
  };
  it("interpolates and wraps", () => {
    expect(horizonElevationAt(mask, 45)).toBeCloseTo(1, 9);
    expect(horizonElevationAt(mask, 315)).toBeCloseTo(1, 9);
    expect(horizonElevationAt(mask, 360)).toBeCloseTo(0, 9);
    expect(horizonElevationAt(null, 123)).toBe(0);
  });
  it("disk fraction above a chord", () => {
    expect(diskFractionAbove(0, 0, 0.27)).toBeCloseTo(0.5, 9);
    expect(diskFractionAbove(1, 0, 0.27)).toBe(1);
    expect(diskFractionAbove(-1, 0, 0.27)).toBe(0);
    expect(diskFractionAbove(0.1, 0, 0.27)).toBeGreaterThan(0.5);
  });
});
