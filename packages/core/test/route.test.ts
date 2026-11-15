/**
 * Rover routes (route.ts) on synthetic relief grids: straight lines on flat
 * ground, detours around steep walls, enclosed pits, the sunlight preference,
 * and A* against plain Dijkstra for optimality.
 */
import { describe, expect, it } from "vitest";
import {
  cellValuesOnRelief,
  DEFAULT_ROUTE_PARAMS,
  gridSlopesDeg,
  planRoute,
  type LocalGrid,
  type Route,
  type RouteInput,
} from "../src";

const STEP = 100;

/** Grid of n × n nodes, 100 m apart, heights from f(row, col). */
function grid(n: number, f: (row: number, col: number) => number): LocalGrid {
  const heightM = new Float32Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) heightM[i * n + j] = f(i, j);
  return { halfM: ((n - 1) / 2) * STEP, stepM: STEP, n, radiusM: Infinity, heightM };
}

const CENTER = { lat: -89.5, lon: 0 };

function route(input: Omit<RouteInput, "center">): Route {
  const r = planRoute({ center: CENTER, ...input });
  if (!r.ok) throw new Error(`no route: ${r.reason}`);
  return r.route;
}

/** Every step moves to one of the 8 neighbours. */
function contiguous(r: Route): boolean {
  return r.points.every(
    (p, q) =>
      q === 0 ||
      (Math.max(Math.abs(p.row - r.points[q - 1].row), Math.abs(p.col - r.points[q - 1].col)) === 1),
  );
}

describe("gridSlopesDeg", () => {
  it("reads the slope of a tilted plane everywhere, edges included", () => {
    const t = Math.tan((10 * Math.PI) / 180);
    const s = gridSlopesDeg(grid(9, (_, j) => j * STEP * t));
    for (const v of s) expect(v).toBeCloseTo(10, 4);
  });
});

describe("cellValuesOnRelief", () => {
  it("puts each cell value on its node and interpolates between them", () => {
    // 3 × 3 cells over 11 × 11 nodes: k = 5.
    const h = { n: 3, relief: grid(11, () => 0) };
    const v = [0, 1, 0, 1, 2, 1, 0, 1, 0];
    const out = cellValuesOnRelief(h, v);
    expect(out[0]).toBe(0);
    expect(out[5 * 11 + 5]).toBe(2);
    expect(out[10 * 11 + 10]).toBe(0);
    expect(out[0 * 11 + 5]).toBe(1);
    expect(out[5 * 11 + 5 - 2]).toBeCloseTo(1 + 0.6, 6); // 3/5 of the way from 1 to 2
  });
});

describe("planRoute", () => {
  it("drives straight across flat ground", () => {
    const g = grid(41, () => 0);
    const r = route({ grid: g, start: { row: 20, col: 0 }, goal: { row: 20, col: 40 } });
    expect(r.points).toHaveLength(41);
    expect(r.lengthM).toBeCloseTo(4000, 6);
    expect(r.straightM).toBeCloseTo(4000, 6);
    expect(r.maxSlopeDeg).toBe(0);
    expect(r.climbM).toBe(0);
    expect(r.meanSunShare).toBeNull();
    expect(r.estimatedTimeH).toBeCloseTo(4000 / DEFAULT_ROUTE_PARAMS.roverSpeedMps / 3600, 6);
    expect(r.points[0]).toMatchObject({ row: 20, col: 0, distanceM: 0 });
    expect(r.points.at(-1)).toMatchObject({ row: 20, col: 40 });
    // The middle node is the grid's centre, so it is the centre point.
    expect(r.points[20].lat).toBeCloseTo(CENTER.lat, 9);

    const d = route({ grid: g, start: { row: 0, col: 0 }, goal: { row: 40, col: 40 } });
    expect(d.lengthM).toBeCloseTo(40 * Math.SQRT2 * STEP, 6);
  });

  it("goes round a steep wall through its gap", () => {
    // A 200 m wall along column 20, open only at the north end (rows 0–5).
    const g = grid(41, (i, j) => (j === 20 && i > 5 ? 200 : 0));
    const r = route({ grid: g, start: { row: 30, col: 2 }, goal: { row: 30, col: 38 } });
    expect(contiguous(r)).toBe(true);
    expect(Math.min(...r.points.map((p) => p.row))).toBeLessThanOrEqual(4);
    expect(r.lengthM).toBeGreaterThan(r.straightM * 1.5);
    expect(r.maxSlopeDeg).toBeLessThanOrEqual(DEFAULT_ROUTE_PARAMS.maxSlopeDeg);
    expect(r.climbM).toBe(0);
  });

  it("reports an enclosed start, a blocked goal and an off-grid point", () => {
    // A 300 m ring wall 8–10 nodes from the centre (flat on top, steep flanks).
    const g = grid(41, (i, j) => {
      const r = Math.hypot(i - 20, j - 20);
      return r >= 8 && r <= 10 ? 300 : 0;
    });
    const c = { center: CENTER, grid: g };
    expect(planRoute({ ...c, start: { row: 20, col: 20 }, goal: { row: 0, col: 0 } })).toEqual({
      ok: false,
      reason: "no-path",
    });
    expect(planRoute({ ...c, start: { row: 0, col: 0 }, goal: { row: 20, col: 12 } })).toEqual({
      ok: false,
      reason: "blocked-goal",
    });
    expect(planRoute({ ...c, start: { row: 20, col: 12 }, goal: { row: 0, col: 0 } })).toEqual({
      ok: false,
      reason: "blocked-start",
    });
    expect(planRoute({ ...c, start: { row: 0, col: 0 }, goal: { row: 0, col: 41 } })).toEqual({
      ok: false,
      reason: "out-of-grid",
    });
    // A rover that climbs anything gets out (the wall's flanks are ≈ 72°).
    const out = route({ ...c, start: { row: 20, col: 20 }, goal: { row: 0, col: 0 }, params: { maxSlopeDeg: 80 } });
    expect(out.climbM).toBeGreaterThanOrEqual(300);
    expect(out.descentM).toBeGreaterThanOrEqual(300);
  });

  it("detours to stay in sunlight only when asked to", () => {
    const n = 41;
    const g = grid(n, () => 0);
    // Never-lit block across the straight line, lit elsewhere.
    const sun = new Float32Array(n * n).fill(1);
    for (let i = 12; i <= 28; i++) for (let j = 8; j <= 32; j++) sun[i * n + j] = 0;
    const base = { grid: g, sunShare: sun, start: { row: 20, col: 0 }, goal: { row: 20, col: 40 } };
    const direct = route({ ...base, params: { shadowWeight: 0 } });
    const lit = route({ ...base, params: { shadowWeight: 3 } });
    expect(direct.lengthM).toBeCloseTo(4000, 6);
    expect(direct.meanSunShare!).toBeLessThan(0.5);
    expect(lit.lengthM).toBeGreaterThan(4000);
    expect(lit.meanSunShare!).toBeGreaterThan(0.95);
  });

  it("finds the same cost as plain Dijkstra on rough ground", () => {
    const g = grid(61, (i, j) => 40 * Math.sin(i / 3) * Math.cos(j / 4) + 25 * Math.sin((i + 2 * j) / 7));
    const n = g.n;
    const sun = new Float32Array(n * n).map((_, k) => 0.5 + 0.5 * Math.sin(k / 37));
    const base = { grid: g, sunShare: sun, start: { row: 3, col: 5 }, goal: { row: 55, col: 52 } };
    const a = route(base);
    const d = route({ ...base, heuristic: false });
    expect(a.totalCost).toBeCloseTo(d.totalCost, 6);
    expect(a.expanded).toBeLessThan(d.expanded);
    expect(contiguous(a)).toBe(true);
    for (const p of a.points) expect(p.slopeDeg).toBeLessThanOrEqual(15);
  });
});
