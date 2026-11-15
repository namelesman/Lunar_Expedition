/**
 * Sunlight / Earth-visibility map (illumination.ts) on a synthetic DEM:
 * every cell's horizon, marched on the local grids, against horizonMask run
 * at that cell's own lat/lon on the same DEM; and the map's sunlit share
 * against computeConditions with that cell's horizon.
 */
import { describe, expect, it } from "vitest";
import {
  cellHorizonMask,
  computeCellHorizons,
  computeConditions,
  greatCircleDistanceM,
  horizonElevationAt,
  horizonMask,
  illuminationFractions,
  skySeries,
  type DemSampler,
  type LatLon,
} from "../src";

/** Gaussian hills and pits at fixed points (heights in m, widths in m). */
function syntheticDem(features: { p: LatLon; h: number; w: number }[]): DemSampler {
  return {
    name: "synthetic",
    sample: (lat, lon) => {
      let z = 0;
      for (const f of features) {
        const d = greatCircleDistanceM({ lat, lon }, f.p);
        z += f.h * Math.exp(-((d / f.w) ** 2));
      }
      return z;
    },
  };
}

function maxDiff(a: number[], b: number[]): number {
  let m = 0;
  a.forEach((v, i) => (m = Math.max(m, Math.abs(v - b[i]))));
  return m;
}

const CASES: { name: string; site: LatLon; features: { p: LatLon; h: number; w: number }[] }[] = [
  {
    // A crater rim and massifs around a south-polar site, one across the pole.
    name: "south polar",
    site: { lat: -89.6, lon: 45 },
    features: [
      { p: { lat: -89.75, lon: 100 }, h: 1500, w: 4000 },
      { p: { lat: -89.4, lon: -10 }, h: -900, w: 3000 },
      { p: { lat: -88.0, lon: 200 }, h: 4000, w: 20000 },
      { p: { lat: -89.9, lon: -120 }, h: 800, w: 2500 },
    ],
  },
  {
    name: "equatorial",
    site: { lat: 0.67, lon: 23.47 },
    features: [
      { p: { lat: 0.75, lon: 23.6 }, h: 1200, w: 3000 },
      { p: { lat: 0.5, lon: 23.3 }, h: -700, w: 4000 },
      { p: { lat: 2.5, lon: 24 }, h: 3000, w: 25000 },
    ],
  },
];

describe("illumination map", () => {
  for (const tc of CASES) {
    it(`${tc.name}: cell horizons match horizonMask at the cell (< 0.3°)`, () => {
      const dem = syntheticDem(tc.features);
      const h = computeCellHorizons({ near: dem }, "t", tc.site.lat, tc.site.lon);
      const n = h.n;
      const m = (n - 1) / 2;
      const cells: [number, number][] = [
        [m, m],
        [0, 0],
        [0, n - 1],
        [n - 1, 0],
        [n - 1, n - 1],
        [m, 3],
        [7, m + 5],
      ];
      for (const [r, c] of cells) {
        const cell = cellHorizonMask(h, r, c);
        const ref = horizonMask({ near: dem }, "ref", cell.lat, cell.lon);
        const refAt = cell.elevationsDeg.map((_, k) =>
          horizonElevationAt(ref, k * cell.azimuthStepDeg),
        );
        expect(Math.abs(cell.siteElevationM - ref.siteElevationM)).toBeLessThan(2);
        expect(maxDiff(cell.elevationsDeg, refAt)).toBeLessThan(0.3);
      }
    }, 60_000);
  }

  it("sunlit / Earth-visible share of a cell matches computeConditions with its horizon", () => {
    const tc = CASES[0];
    const dem = syntheticDem(tc.features);
    const h = computeCellHorizons({ near: dem }, "t", tc.site.lat, tc.site.lon);
    const start = Date.UTC(2026, 10, 1);
    const sky = skySeries(start, start + 30 * 86_400_000, 30);
    const map = illuminationFractions(h, sky);
    const m = (h.n - 1) / 2;
    for (const [r, c] of [
      [m, m],
      [0, 0],
      [h.n - 1, 4],
    ] as const) {
      const mask = cellHorizonMask(h, r, c);
      const cond = computeConditions("t", mask, mask, sky);
      const idx = r * h.n + c;
      // Two interpolations of the same 2° horizon: a couple of samples at most.
      expect(Math.abs(map.sun[idx] - cond.sunlitFraction)).toBeLessThanOrEqual(
        3 / sky.length,
      );
      expect(
        Math.abs(map.earth[idx] - cond.earthVisibleFraction),
      ).toBeLessThanOrEqual(3 / sky.length);
    }
    // The terrain matters: the map is not uniform.
    const sun = Array.from(map.sun);
    expect(Math.max(...sun) - Math.min(...sun)).toBeGreaterThan(0.05);
  }, 60_000);
});
