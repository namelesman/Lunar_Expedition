import { RAD, localMToLatLon } from "./coords";
import type { CellHorizons, LocalGrid } from "./illumination";
import {
  DEFAULT_ROUTE_PARAMS,
  type GridCell,
  type LatLon,
  type Route,
  type RouteParams,
  type RoutePoint,
  type RouteResult,
} from "./types";

/**
 * Rover routes on the relief grid of the sunlight map (100 m nodes, ±10 km).
 *
 * A* over the 8 neighbours of each node. Ground steeper than maxSlopeDeg is
 * impassable (the node's own slope and the slope along the step); otherwise
 * a step costs its length along the ground times the mean of its two nodes'
 * multipliers, 1 + slopeWeight·(slope/max)² and 1 + shadowWeight·(1 − sunlit
 * share). The heuristic is the octile distance on the map, never more than
 * the true cost (every multiplier ≥ 1, ground length ≥ map length), so the
 * route found is the cheapest one on the grid.
 *
 * The grid only sees what the DEM resolves: boulders and craters smaller
 * than its pixels are not there. A planning sketch, not a traverse plan.
 */

/**
 * Steepest slope (deg) at every node of a grid, from central differences
 * (one-sided on the grid's edge).
 */
export function gridSlopesDeg(g: LocalGrid): Float32Array {
  const { n, stepM, heightM: z } = g;
  const out = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    const iu = Math.max(0, i - 1),
      id = Math.min(n - 1, i + 1);
    for (let j = 0; j < n; j++) {
      const jl = Math.max(0, j - 1),
        jr = Math.min(n - 1, j + 1);
      const dzdx = (z[i * n + jr] - z[i * n + jl]) / ((jr - jl) * stepM);
      const dzdy = (z[iu * n + j] - z[id * n + j]) / ((id - iu) * stepM); // row 0 = north
      out[i * n + j] = Math.atan(Math.hypot(dzdx, dzdy)) * RAD;
    }
  }
  return out;
}

/**
 * Per-cell values of the sunlight map (n × n cells, 500 m) resampled on the
 * relief grid's nodes (100 m) by bilinear interpolation. Both grids span the
 * same square, so cell (r, c) sits on node (r·k, c·k), k = 5.
 */
export function cellValuesOnRelief(
  h: Pick<CellHorizons, "n" | "relief">,
  values: ArrayLike<number>,
): Float32Array {
  const n = h.n;
  const rn = h.relief.n;
  const k = (rn - 1) / (n - 1);
  const out = new Float32Array(rn * rn);
  for (let i = 0; i < rn; i++) {
    const v = i / k;
    const r0 = Math.min(n - 2, Math.floor(v)),
      fv = v - r0;
    for (let j = 0; j < rn; j++) {
      const u = j / k;
      const c0 = Math.min(n - 2, Math.floor(u)),
        fu = u - c0;
      const a = r0 * n + c0;
      out[i * rn + j] =
        (values[a] * (1 - fu) + values[a + 1] * fu) * (1 - fv) +
        (values[a + n] * (1 - fu) + values[a + n + 1] * fu) * fv;
    }
  }
  return out;
}

/** Plane offsets (m east, m north) of a grid node from the centre. */
export function gridNodeOffsetM(
  g: Pick<LocalGrid, "halfM" | "stepM">,
  row: number,
  col: number,
): { x: number; y: number } {
  return { x: -g.halfM + col * g.stepM, y: g.halfM - row * g.stepM };
}

export interface RouteInput {
  grid: LocalGrid;
  /** The point at the grid's centre (the site), for the points' lat/lon. */
  center: LatLon;
  start: GridCell;
  goal: GridCell;
  params?: Partial<RouteParams>;
  /** Sunlit share (0–1) at each grid node, e.g. cellValuesOnRelief of the 30-day map. */
  sunShare?: ArrayLike<number>;
  /** gridSlopesDeg(grid), if already computed. */
  slopesDeg?: Float32Array;
  /** false = plain Dijkstra (no heuristic), for tests. */
  heuristic?: boolean;
}

/** Binary min-heap of node indices keyed by f-score (duplicates allowed). */
class NodeHeap {
  private keys = new Float64Array(1024);
  private nodes = new Int32Array(1024);
  size = 0;

  push(key: number, node: number): void {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.keys);
      v.set(this.nodes);
      this.keys = k;
      this.nodes = v;
    }
    const k = this.keys,
      v = this.nodes;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = node;
  }

  pop(): number {
    const k = this.keys,
      v = this.nodes;
    const top = v[0];
    const n = --this.size;
    const lastK = k[n],
      lastV = v[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && k[c + 1] < k[c]) c++;
      if (k[c] >= lastK) break;
      k[i] = k[c];
      v[i] = v[c];
      i = c;
    }
    k[i] = lastK;
    v[i] = lastV;
    return top;
  }
}

const NEIGHBOURS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Cheapest rover route between two nodes of a grid (see the module comment). */
export function planRoute(input: RouteInput): RouteResult {
  const p: RouteParams = { ...DEFAULT_ROUTE_PARAMS, ...input.params };
  const g = input.grid;
  const { n, stepM: step, heightM: z } = g;
  const { start, goal, sunShare: sun } = input;
  const inside = (row: number, col: number) => {
    if (row < 0 || col < 0 || row >= n || col >= n) return false;
    const { x, y } = gridNodeOffsetM(g, row, col);
    return Math.hypot(x, y) <= g.radiusM;
  };
  if (
    ![start.row, start.col, goal.row, goal.col].every(Number.isInteger) ||
    !inside(start.row, start.col) ||
    !inside(goal.row, goal.col)
  )
    return { ok: false, reason: "out-of-grid" };

  const slope = input.slopesDeg ?? gridSlopesDeg(g);
  const maxSlope = Math.max(1e-6, p.maxSlopeDeg);
  const maxRise = Math.tan(Math.min(89.9, maxSlope) / RAD);
  const count = n * n;
  // Cost multiplier per node; 0 = impassable.
  const mult = new Float64Array(count);
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const k = row * n + col;
      if (slope[k] > maxSlope || !inside(row, col)) continue;
      const s = slope[k] / maxSlope;
      const lit = sun ? Math.min(1, Math.max(0, sun[k])) : 1;
      mult[k] = (1 + p.slopeWeight * s * s) * (1 + p.shadowWeight * (1 - lit));
    }
  const s0 = start.row * n + start.col;
  const t0 = goal.row * n + goal.col;
  if (!mult[s0]) return { ok: false, reason: "blocked-start" };
  if (!mult[t0]) return { ok: false, reason: "blocked-goal" };

  const useH = input.heuristic !== false;
  const hCost = (k: number) => {
    if (!useH) return 0;
    const di = Math.abs(Math.floor(k / n) - goal.row);
    const dj = Math.abs((k % n) - goal.col);
    return step * (Math.max(di, dj) + (Math.SQRT2 - 1) * Math.min(di, dj));
  };
  const gScore = new Float64Array(count).fill(Infinity);
  const from = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const heap = new NodeHeap();
  gScore[s0] = 0;
  heap.push(hCost(s0), s0);
  let expanded = 0;
  while (heap.size > 0) {
    const a = heap.pop();
    if (closed[a]) continue;
    closed[a] = 1;
    expanded++;
    if (a === t0) break;
    const ai = Math.floor(a / n),
      aj = a % n;
    for (const [di, dj] of NEIGHBOURS) {
      const bi = ai + di,
        bj = aj + dj;
      if (bi < 0 || bj < 0 || bi >= n || bj >= n) continue;
      const b = bi * n + bj;
      if (closed[b] || !mult[b]) continue;
      const diag = di !== 0 && dj !== 0;
      // No squeezing diagonally between two impassable nodes.
      if (diag && !mult[ai * n + bj] && !mult[bi * n + aj]) continue;
      const d = diag ? step * Math.SQRT2 : step;
      const dh = z[b] - z[a];
      if (Math.abs(dh) > maxRise * d) continue;
      const cost = gScore[a] + Math.hypot(d, dh) * 0.5 * (mult[a] + mult[b]);
      if (cost < gScore[b]) {
        gScore[b] = cost;
        from[b] = a;
        heap.push(cost + hCost(b), b);
      }
    }
  }
  if (!closed[t0]) return { ok: false, reason: "no-path" };

  const path: number[] = [];
  for (let k = t0; k !== -1; k = from[k]) path.push(k);
  path.reverse();

  const points: RoutePoint[] = [];
  let dist = 0,
    climb = 0,
    descent = 0,
    maxSeen = 0,
    sunLen = 0;
  for (let q = 0; q < path.length; q++) {
    const k = path[q];
    const row = Math.floor(k / n),
      col = k % n;
    if (q > 0) {
      const a = path[q - 1];
      const d = Math.floor(a / n) !== row && a % n !== col ? step * Math.SQRT2 : step;
      const dh = z[k] - z[a];
      const seg = Math.hypot(d, dh);
      dist += seg;
      if (dh > 0) climb += dh;
      else descent -= dh;
      maxSeen = Math.max(maxSeen, Math.atan(Math.abs(dh) / d) * RAD);
      if (sun) sunLen += seg * 0.5 * (sun[a] + sun[k]);
    }
    maxSeen = Math.max(maxSeen, slope[k]);
    const { x, y } = gridNodeOffsetM(g, row, col);
    points.push({
      row,
      col,
      ...localMToLatLon(input.center, x, y),
      elevationM: z[k],
      distanceM: dist,
      slopeDeg: slope[k],
      sunShare: sun ? sun[k] : null,
    });
  }
  const a = gridNodeOffsetM(g, start.row, start.col);
  const b = gridNodeOffsetM(g, goal.row, goal.col);
  const route: Route = {
    params: p,
    start: { row: start.row, col: start.col },
    goal: { row: goal.row, col: goal.col },
    points,
    lengthM: dist,
    straightM: Math.hypot(b.x - a.x, b.y - a.y),
    maxSlopeDeg: maxSeen,
    climbM: climb,
    descentM: descent,
    meanSunShare: sun ? (dist > 0 ? sunLen / dist : sun[s0]) : null,
    estimatedTimeH: dist / Math.max(1e-9, p.roverSpeedMps) / 3600,
    totalCost: gScore[t0],
    expanded,
  };
  return { ok: true, route };
}
