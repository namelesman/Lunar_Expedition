import { describe, expect, it } from "vitest";
import {
  AU_KM,
  SOLAR_CONSTANT_WM2,
  computeConditions,
  panelIrradianceWm2,
  skySeries,
  solarEnergy,
  solarIrradianceWm2,
} from "../src";

const DAY = 86_400_000;
const start = Date.UTC(2026, 10, 14);
// Two full lunations so the day/night cycle averages out.
const sky = skySeries(start, start + 59 * DAY, 30);

describe("solar energy", () => {
  it("scales the solar constant with the inverse square of the Sun's distance", () => {
    expect(solarIrradianceWm2(AU_KM)).toBeCloseTo(SOLAR_CONSTANT_WM2, 6);
    expect(solarIrradianceWm2(AU_KM * 2)).toBeCloseTo(SOLAR_CONSTANT_WM2 / 4, 6);
    // The Sun–Moon distance stays within about ±1.9 % of 1 AU.
    for (const s of sky) {
      expect(Math.abs(s.sunDistanceKm / AU_KM - 1)).toBeLessThan(0.02);
    }
  });

  it("projects onto vertical and flat panels and scales with the visible disk", () => {
    const up = panelIrradianceWm2({ sunElevationDeg: 30, sunVisibleFraction: 1 });
    expect(up.vertical).toBeCloseTo(SOLAR_CONSTANT_WM2 * Math.cos(Math.PI / 6), 6);
    expect(up.horizontal).toBeCloseTo(SOLAR_CONSTANT_WM2 * 0.5, 6);
    const half = panelIrradianceWm2({ sunElevationDeg: 0.2, sunVisibleFraction: 0.5 });
    expect(half.vertical).toBeCloseTo(SOLAR_CONSTANT_WM2 * 0.5 * Math.cos(0.2 * (Math.PI / 180)), 6);
    const below = panelIrradianceWm2({ sunElevationDeg: -0.5, sunVisibleFraction: 0.3 });
    expect(below.horizontal).toBe(0);
    expect(below.vertical).toBeGreaterThan(0);
    const hidden = panelIrradianceWm2({ sunElevationDeg: 5, sunVisibleFraction: 0 });
    expect(hidden).toEqual({ vertical: 0, horizontal: 0 });
  });

  it("averages S/π on both panels at the equator (smooth sphere)", () => {
    // Over a full day/night cycle the mean of max(0, cos H) is 1/π; for a
    // vertical panel facing the Sun, cos(elevation) = sin|H| averages the same.
    const c = computeConditions("eq", { lat: 0, lon: 0 }, null, sky);
    const e = solarEnergy(c, sky);
    const expected = SOLAR_CONSTANT_WM2 / Math.PI;
    expect(Math.abs(e.horizontalMeanWm2 / expected - 1)).toBeLessThan(0.05);
    expect(Math.abs(e.verticalMeanWm2 / expected - 1)).toBeLessThan(0.05);
    expect(e.horizontalPeakWm2).toBeGreaterThan(1300);
    expect(e.verticalWhPerM2).toBeCloseTo(e.verticalMeanWm2 * e.hours, 6);
    expect(e.hours).toBeCloseTo(59 * 24, 6);
  });

  it("near the pole a vertical panel gets far more than a flat one", () => {
    const c = computeConditions("pole", { lat: -89.67, lon: 129.78 }, null, sky);
    const e = solarEnergy(c, sky);
    // The Sun stays within ~1.6° of the horizon: a flat panel gets almost nothing.
    expect(e.horizontalPeakWm2).toBeLessThan(SOLAR_CONSTANT_WM2 * Math.sin(2.5 * (Math.PI / 180)));
    // A vertical panel gets about the sunlit share of the full flux.
    const lit = c.sunlitFraction * SOLAR_CONSTANT_WM2;
    expect(Math.abs(e.verticalMeanWm2 - lit) / SOLAR_CONSTANT_WM2).toBeLessThan(0.05);
    expect(e.verticalMeanWm2).toBeGreaterThan(10 * e.horizontalMeanWm2);
  });

  it("falls back to 1 AU without the sky series", () => {
    const c = computeConditions("eq", { lat: 0, lon: 0 }, null, sky);
    const a = solarEnergy(c, sky);
    const b = solarEnergy(c);
    expect(Math.abs(a.verticalMeanWm2 / b.verticalMeanWm2 - 1)).toBeLessThan(0.04);
  });
});
