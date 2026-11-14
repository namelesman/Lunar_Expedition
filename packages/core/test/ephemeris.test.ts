import * as Astronomy from "astronomy-engine";
import { describe, expect, it } from "vitest";
import {
  bodyPositionAt,
  diskFractionAbove,
  earthFixedBasis,
  earthIlluminatedFraction,
  eqjToSceneBasis,
  horizonElevationAt,
  moonSkyState,
  type Basis3,
  type HorizonMask,
  type Vec3,
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

describe("sky orientation (star map and Earth texture)", () => {
  const dotv = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const expectRightHandedOrthonormal = ([x, y, z]: Basis3) => {
    for (const v of [x, y, z]) expect(dotv(v, v)).toBeCloseTo(1, 12);
    expect(dotv(x, y)).toBeCloseTo(0, 12);
    expect(dotv(y, z)).toBeCloseTo(0, 12);
    expect(dotv(x, z)).toBeCloseTo(0, 12);
    const c = cross(x, y);
    expect(dotv(c, z)).toBeCloseTo(1, 12);
  };

  it("returns right-handed orthonormal bases", () => {
    expectRightHandedOrthonormal(eqjToSceneBasis(T));
    expectRightHandedOrthonormal(earthFixedBasis(T));
  });

  it("maps the EQJ Moon→Sun vector onto moonSkyState().sunDir", () => {
    const t = Astronomy.MakeTime(new Date(T));
    const moon = Astronomy.GeoMoon(t);
    const sun = Astronomy.GeoVector(Astronomy.Body.Sun, t, false);
    const v = { x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z };
    const n = Math.hypot(v.x, v.y, v.z);
    const [bx, by, bz] = eqjToSceneBasis(T);
    const s = {
      x: (bx.x * v.x + by.x * v.y + bz.x * v.z) / n,
      y: (bx.y * v.x + by.y * v.y + bz.y * v.z) / n,
      z: (bx.z * v.x + by.z * v.y + bz.z * v.z) / n,
    };
    const ref = moonSkyState(T).sunDir;
    expect(dotv(s, ref)).toBeCloseTo(1, 12);
  });

  it("puts the sub-lunar point where RA(of date) − GAST says", () => {
    // Scene route: Earth→Moon = −earthDir, read in Earth-fixed axes.
    const [e0, e90, eN] = earthFixedBasis(T);
    const e = moonSkyState(T).earthDir;
    const d = { x: -e.x, y: -e.y, z: -e.z };
    const lon = Math.atan2(dotv(d, e90), dotv(d, e0)) * (180 / Math.PI);
    const lat = Math.asin(dotv(d, eN)) * (180 / Math.PI);
    // Direct route: geocentric Moon in the true equator of date.
    const t = Astronomy.MakeTime(new Date(T));
    const m = Astronomy.RotateVector(
      Astronomy.Rotation_EQJ_EQD(t),
      Astronomy.GeoMoon(t),
    );
    const ra = Math.atan2(m.y, m.x) * (180 / Math.PI);
    const dec = Math.atan2(m.z, Math.hypot(m.x, m.y)) * (180 / Math.PI);
    const lonRef = ((ra - Astronomy.SiderealTime(t) * 15 + 540) % 360) - 180;
    const dLon = ((lon - lonRef + 540) % 360) - 180;
    expect(Math.abs(dLon)).toBeLessThan(0.01);
    expect(lat).toBeCloseTo(dec, 2);
    expect(Math.abs(lat)).toBeLessThan(29);
  });

  it("gives a full Earth at new Moon and a new Earth at full Moon", () => {
    const start = Astronomy.MakeTime(new Date(T));
    const newMoon = Astronomy.SearchMoonPhase(0, start, 40)!;
    const fullMoon = Astronomy.SearchMoonPhase(180, start, 40)!;
    expect(
      earthIlluminatedFraction(moonSkyState(newMoon.date)),
    ).toBeGreaterThan(0.99);
    expect(earthIlluminatedFraction(moonSkyState(fullMoon.date))).toBeLessThan(
      0.01,
    );
  });
});
