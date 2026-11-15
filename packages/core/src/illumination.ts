/**
 * Sunlight and Earth-visibility map around a site: the terrain horizon of every
 * cell of a 20 × 20 km grid, then the share of a time window during which the
 * Sun (power) and the Earth (direct-to-Earth comms) are above it.
 *
 * Terrain comes from the same near/far DEMs as the site horizon (terrain.ts),
 * resampled once onto two local grids in an azimuthal-equidistant projection
 * centred on the site (well-behaved at the poles):
 *   near grid ±60 km at 100 m (the 0–50 km march of every cell),
 *   far grid ±310 km at 1 km (50–300 km).
 * Each cell marches like horizonMask — same observer height, same exact
 * curvature — along straight lines of that plane. Within 14 km of the centre
 * the projection keeps distances and angles to better than 1e-5, so a line of
 * the plane is the great circle to well under a pixel.
 *
 * Pure code: no Node or DOM APIs (it runs in a Web Worker).
 */
import {
  DEG,
  RAD,
  enuBasis,
  latLonToLocalM,
  localMToLatLon,
} from "./coords";
import {
  collectTiles,
  loadTiles,
  tiledDems,
  type TileLoadStats,
  type TiledHorizonOptions,
} from "./demTiles";
import type { MoonSkyState } from "./ephemeris";
import {
  HORIZON_MAX_KM,
  HORIZON_NEAR_KM,
  HORIZON_OBSERVER_HEIGHT_M,
  type DemSampler,
  type HorizonDems,
} from "./terrain";
import { MOON_RADIUS_M, type HorizonMask, type LatLon } from "./types";

/** Half-width of the map (m): the map covers ±10 km around the site. */
export const ILLUM_HALF_M = 10_000;
/** Map cell size (m). */
export const ILLUM_CELL_M = 500;
/** Horizon azimuths per cell (2° steps). */
export const ILLUM_AZIMUTHS = 180;
/** Spacing of the local elevation grids (m). */
export const ILLUM_NEAR_GRID_M = 100;
export const ILLUM_FAR_GRID_M = 1_000;

export interface IlluminationOptions {
  halfM?: number;
  cellM?: number;
  azimuths?: number;
}

/**
 * Elevations on a square grid of the site's azimuthal-equidistant plane.
 * Node (i, j) is at x = −halfM + j·stepM (east), y = halfM − i·stepM (north):
 * row 0 is the north edge. Nodes farther than `radiusM` from the centre are
 * never read and hold 0.
 */
export interface LocalGrid {
  halfM: number;
  stepM: number;
  /** Nodes per side. */
  n: number;
  radiusM: number;
  heightM: Float32Array;
}

function gridNodes(halfM: number, stepM: number): number {
  return Math.round((2 * halfM) / stepM) + 1;
}

/** Visits the grid nodes that a LocalGrid samples (dry run for the tile list). */
export function forEachGridNode(
  center: LatLon,
  halfM: number,
  stepM: number,
  radiusM: number,
  visit: (p: LatLon, k: number) => void,
): void {
  const n = gridNodes(halfM, stepM);
  for (let i = 0; i < n; i++) {
    const y = halfM - i * stepM;
    for (let j = 0; j < n; j++) {
      const x = -halfM + j * stepM;
      if (Math.hypot(x, y) > radiusM) continue;
      visit(localMToLatLon(center, x, y), i * n + j);
    }
  }
}

/** Samples a DEM on a LocalGrid; throws if the DEM does not cover a node. */
export function sampleLocalGrid(
  dem: DemSampler,
  center: LatLon,
  halfM: number,
  stepM: number,
  radiusM: number,
): LocalGrid {
  const n = gridNodes(halfM, stepM);
  const heightM = new Float32Array(n * n);
  let bad = 0;
  forEachGridNode(center, halfM, stepM, radiusM, (p, k) => {
    const h = dem.sample(p.lat, p.lon);
    if (Number.isNaN(h)) bad++;
    else heightM[k] = h;
  });
  if (bad > 0) throw new Error(`${dem.name}: ${bad} grid nodes not covered`);
  return { halfM, stepM, n, radiusM, heightM };
}

/** Bilinear height at plane coordinates (m). */
function gridHeight(g: LocalGrid, x: number, y: number): number {
  const gx = (x + g.halfM) / g.stepM;
  const gy = (g.halfM - y) / g.stepM;
  const n = g.n;
  let j = Math.floor(gx),
    i = Math.floor(gy);
  if (j < 0) j = 0;
  else if (j > n - 2) j = n - 2;
  if (i < 0) i = 0;
  else if (i > n - 2) i = n - 2;
  const fx = gx - j,
    fy = gy - i;
  const h = g.heightM;
  const k = i * n + j;
  return (
    (h[k] * (1 - fx) + h[k + 1] * fx) * (1 - fy) +
    (h[k + n] * (1 - fx) + h[k + n + 1] * fx) * fy
  );
}

/**
 * Highest tan(elevation) along one march over a grid, starting from `best`.
 * tan e = (r1 cos t − r0) / (r1 sin t), the same angle as the atan2 of
 * horizonMask; r1 sin t > 0, so the comparison needs no division.
 * (gx0, gy0) is the start in grid nodes, (ux, uy) the step per metre.
 */
function marchMaxTan(
  H: Float32Array,
  n: number,
  gx0: number,
  gy0: number,
  ux: number,
  uy: number,
  dist: Float64Array,
  cosT: Float64Array,
  sinT: Float64Array,
  r0: number,
  best: number,
): number {
  const R = MOON_RADIUS_M;
  const last = n - 2;
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    const gx = gx0 + d * ux,
      gy = gy0 + d * uy;
    // Every sample lies inside the grid (gx, gy ≥ 0): truncation is floor.
    let j = gx | 0,
      r = gy | 0;
    if (j > last) j = last;
    if (r > last) r = last;
    const fx = gx - j,
      fy = gy - r;
    const k = r * n + j;
    const h =
      (H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) +
      (H[k + n] * (1 - fx) + H[k + n + 1] * fx) * fy;
    const r1 = R + h;
    const num = r1 * cosT[i] - r0,
      den = r1 * sinT[i];
    if (num > best * den) best = num / den;
  }
  return best;
}

/** Distances (m) of the per-cell march: denser than needed for 500 m cells near them. */
export function cellMarchDistancesM(): { near: number[]; far: number[] } {
  const near: number[] = [];
  for (let d = 100; d <= 2_000; d += 100) near.push(d);
  for (let d = 2_200; d <= 10_000; d += 200) near.push(d);
  for (let d = 10_500; d <= HORIZON_NEAR_KM * 1000; d += 500) near.push(d);
  const far: number[] = [];
  for (let d = HORIZON_NEAR_KM * 1000 + 1000; d <= HORIZON_MAX_KM * 1000; d += 1000)
    far.push(d);
  return { near, far };
}

function geometry(o: IlluminationOptions = {}) {
  const halfM = o.halfM ?? ILLUM_HALF_M;
  const cellM = o.cellM ?? ILLUM_CELL_M;
  const azimuths = o.azimuths ?? ILLUM_AZIMUTHS;
  const reach = halfM * Math.SQRT2; // farthest cell from the centre
  const nearHalfM = halfM + HORIZON_NEAR_KM * 1000;
  const farHalfM = halfM + HORIZON_MAX_KM * 1000;
  return {
    halfM,
    cellM,
    azimuths,
    n: gridNodes(halfM, cellM),
    nearHalfM,
    farHalfM,
    // Two grid steps of margin for the bilinear footprint.
    nearRadiusM: reach + HORIZON_NEAR_KM * 1000 + 2 * ILLUM_NEAR_GRID_M,
    farRadiusM: reach + HORIZON_MAX_KM * 1000 + 2 * ILLUM_FAR_GRID_M,
  };
}

/**
 * Visits every DEM sample of computeCellHorizons (near grid → near stack, far
 * grid → far stack), for collectTiles.
 */
export function forEachIlluminationSample(
  lat: number,
  lon: number,
  visit: (p: LatLon, near: boolean) => void,
  o?: IlluminationOptions,
): void {
  const g = geometry(o);
  const c = { lat, lon };
  forEachGridNode(c, g.nearHalfM, ILLUM_NEAR_GRID_M, g.nearRadiusM, (p) =>
    visit(p, true),
  );
  forEachGridNode(c, g.farHalfM, ILLUM_FAR_GRID_M, g.farRadiusM, (p) =>
    visit(p, false),
  );
}

export interface CellHorizons {
  siteId: string;
  lat: number;
  lon: number;
  /**
   * Cells per side. Cell (r, c) is at x = (c − (n−1)/2)·cellM east and
   * y = ((n−1)/2 − r)·cellM north of the site in its azimuthal-equidistant
   * plane: row 0 is the north edge, the site is the centre cell.
   */
  n: number;
  cellM: number;
  azimuths: number;
  /**
   * Terrain horizon elevation (deg) of cell (r, c) at grid azimuth k
   * (k·360/azimuths, clockwise from the plane's +y): index (r·n + c)·azimuths + k.
   */
  horizonDeg: Float32Array;
  cellLat: Float64Array;
  cellLon: Float64Array;
  /** True bearing (deg) of the plane's +y at each cell (≈ 0 except near the poles). */
  gridNorthDeg: Float32Array;
  cellElevationM: Float32Array;
  /** Elevations of the map area (±halfM at 100 m) for relief shading. */
  relief: LocalGrid;
  observerHeightM: number;
  demSource: string;
}

/** Cell offsets (m) in the site's plane. */
export function cellOffsetM(
  h: Pick<CellHorizons, "n" | "cellM">,
  r: number,
  c: number,
): { x: number; y: number } {
  const m = (h.n - 1) / 2;
  return { x: (c - m) * h.cellM, y: (m - r) * h.cellM };
}

/**
 * Terrain horizon of every map cell. `near`/`far` as in horizonMask; the
 * observer stands HORIZON_OBSERVER_HEIGHT_M above each cell.
 */
export function computeCellHorizons(
  dems: HorizonDems,
  siteId: string,
  lat: number,
  lon: number,
  o?: IlluminationOptions & {
    onProgress?: (phase: "grid" | "horizons", done: number, total: number) => void;
  },
): CellHorizons {
  const g = geometry(o);
  const center = { lat, lon };
  const R = MOON_RADIUS_M;
  const near = dems.near;
  const far = dems.far ?? near;
  o?.onProgress?.("grid", 0, 2);
  const nearGrid = sampleLocalGrid(
    near,
    center,
    g.nearHalfM,
    ILLUM_NEAR_GRID_M,
    g.nearRadiusM,
  );
  o?.onProgress?.("grid", 1, 2);
  const farGrid = sampleLocalGrid(
    far,
    center,
    g.farHalfM,
    ILLUM_FAR_GRID_M,
    g.farRadiusM,
  );
  o?.onProgress?.("grid", 2, 2);

  const { near: dn, far: df } = cellMarchDistancesM();
  const tn = dn.map((d) => d / R),
    tf = df.map((d) => d / R);
  const cosN = Float64Array.from(tn, Math.cos),
    sinN = Float64Array.from(tn, Math.sin);
  const cosF = Float64Array.from(tf, Math.cos),
    sinF = Float64Array.from(tf, Math.sin);
  const A = g.azimuths;
  const sA = new Float64Array(A),
    cA = new Float64Array(A);
  for (let k = 0; k < A; k++) {
    sA[k] = Math.sin(((k * 360) / A) * DEG);
    cA[k] = Math.cos(((k * 360) / A) * DEG);
  }

  const n = g.n;
  const horizonDeg = new Float32Array(n * n * A);
  const cellLat = new Float64Array(n * n);
  const cellLon = new Float64Array(n * n);
  const gridNorthDeg = new Float32Array(n * n);
  const cellElevationM = new Float32Array(n * n);
  const dnA = Float64Array.from(dn),
    dfA = Float64Array.from(df);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const idx = r * n + c;
      const { x: cx, y: cy } = cellOffsetM(g, r, c);
      const p = localMToLatLon(center, cx, cy);
      cellLat[idx] = p.lat;
      cellLon[idx] = p.lon;
      // Bearing, seen from the cell, of a point 10 m up the plane's +y.
      const up = latLonToLocalM(p, localMToLatLon(center, cx, cy + 10));
      gridNorthDeg[idx] = Math.atan2(up.x, up.y) * RAD;
      const h0 = gridHeight(nearGrid, cx, cy);
      cellElevationM[idx] = h0;
      const r0 = R + h0 + HORIZON_OBSERVER_HEIGHT_M;
      const base = idx * A;
      // Plane → fractional grid node coordinates of the cell.
      const ngx = (cx + nearGrid.halfM) / nearGrid.stepM,
        ngy = (nearGrid.halfM - cy) / nearGrid.stepM;
      const fgx = (cx + farGrid.halfM) / farGrid.stepM,
        fgy = (farGrid.halfM - cy) / farGrid.stepM;
      for (let k = 0; k < A; k++) {
        const s = sA[k],
          co = cA[k];
        let best = marchMaxTan(
          nearGrid.heightM,
          nearGrid.n,
          ngx,
          ngy,
          s / nearGrid.stepM,
          -co / nearGrid.stepM,
          dnA,
          cosN,
          sinN,
          r0,
          -Infinity,
        );
        best = marchMaxTan(
          farGrid.heightM,
          farGrid.n,
          fgx,
          fgy,
          s / farGrid.stepM,
          -co / farGrid.stepM,
          dfA,
          cosF,
          sinF,
          r0,
          best,
        );
        horizonDeg[base + k] = Math.atan(best) * RAD;
      }
    }
    o?.onProgress?.("horizons", r + 1, n);
  }

  // The map area of the near grid, for relief shading.
  const rn = gridNodes(g.halfM, ILLUM_NEAR_GRID_M);
  const off = Math.round((g.nearHalfM - g.halfM) / ILLUM_NEAR_GRID_M);
  const relief = new Float32Array(rn * rn);
  for (let i = 0; i < rn; i++)
    for (let j = 0; j < rn; j++)
      relief[i * rn + j] = nearGrid.heightM[(i + off) * nearGrid.n + j + off];

  return {
    siteId,
    lat,
    lon,
    n,
    cellM: g.cellM,
    azimuths: A,
    horizonDeg,
    cellLat,
    cellLon,
    gridNorthDeg,
    cellElevationM,
    relief: {
      halfM: g.halfM,
      stepM: ILLUM_NEAR_GRID_M,
      n: rn,
      radiusM: Infinity,
      heightM: relief,
    },
    observerHeightM: HORIZON_OBSERVER_HEIGHT_M,
    demSource:
      far === near
        ? near.name
        : `${near.name} within ${HORIZON_NEAR_KM} km; ${far.name} ${HORIZON_NEAR_KM}–${HORIZON_MAX_KM} km`,
  };
}

/** Horizon of cell `idx` at a grid azimuth (deg), linear between the stored azimuths. */
function cellHorizonAt(h: CellHorizons, idx: number, gridAzDeg: number): number {
  const A = h.azimuths;
  let f = (gridAzDeg / 360) * A;
  f = ((f % A) + A) % A;
  const k0 = Math.floor(f);
  const k1 = k0 + 1 === A ? 0 : k0 + 1;
  const w = f - k0;
  const b = idx * A;
  return h.horizonDeg[b + k0] * (1 - w) + h.horizonDeg[b + k1] * w;
}

/** The horizon of one cell as a HorizonMask in true azimuths (for comparisons). */
export function cellHorizonMask(
  h: CellHorizons,
  r: number,
  c: number,
): HorizonMask {
  const idx = r * h.n + c;
  const step = 360 / h.azimuths;
  const elevationsDeg: number[] = [];
  for (let k = 0; k < h.azimuths; k++)
    elevationsDeg.push(cellHorizonAt(h, idx, k * step - h.gridNorthDeg[idx]));
  return {
    siteId: `${h.siteId}@${r},${c}`,
    lat: h.cellLat[idx],
    lon: h.cellLon[idx],
    observerHeightM: h.observerHeightM,
    siteElevationM: h.cellElevationM[idx],
    azimuthStepDeg: step,
    elevationsDeg,
    distancesKm: elevationsDeg.map(() => 0),
    maxDistanceKm: HORIZON_MAX_KM,
    demSource: h.demSource,
  };
}

export interface IlluminationMap {
  /** Share (0–1) of the samples with the Sun's centre above the terrain horizon, per cell. */
  sun: Float32Array;
  /** Same for the Earth (direct-to-Earth line of sight). */
  earth: Float32Array;
  samples: number;
  startMs: number;
  endMs: number;
}

/**
 * Share of the sky samples during which the Sun and the Earth are above each
 * cell's terrain horizon. Same criterion as computeConditions: at least half
 * the disk visible ⇔ the centre at or above the horizon. Topocentric
 * directions (Earth parallax) from each cell's own position.
 */
export function illuminationFractions(
  h: CellHorizons,
  sky: MoonSkyState[],
): IlluminationMap {
  const cells = h.n * h.n;
  const sun = new Float32Array(cells);
  const earth = new Float32Array(cells);
  const m = sky.length;
  // Body positions relative to the Moon's centre, km.
  const sx = new Float64Array(m),
    sy = new Float64Array(m),
    sz = new Float64Array(m);
  const ex = new Float64Array(m),
    ey = new Float64Array(m),
    ez = new Float64Array(m);
  sky.forEach((k, i) => {
    sx[i] = k.sunDir.x * k.sunDistanceKm;
    sy[i] = k.sunDir.y * k.sunDistanceKm;
    sz[i] = k.sunDir.z * k.sunDistanceKm;
    ex[i] = k.earthDir.x * k.earthDistanceKm;
    ey[i] = k.earthDir.y * k.earthDistanceKm;
    ez[i] = k.earthDir.z * k.earthDistanceKm;
  });
  const R_KM = MOON_RADIUS_M / 1000;
  for (let idx = 0; idx < cells; idx++) {
    const { east, north, up } = enuBasis(h.cellLat[idx], h.cellLon[idx]);
    const rk = R_KM + h.cellElevationM[idx] / 1000;
    const px = up.x * rk,
      py = up.y * rk,
      pz = up.z * rk;
    const gn = h.gridNorthDeg[idx];
    const visible = (x: number, y: number, z: number) => {
      const vx = x - px,
        vy = y - py,
        vz = z - pz;
      const e = vx * east.x + vy * east.y + vz * east.z;
      const nn = vx * north.x + vy * north.y + vz * north.z;
      const u = vx * up.x + vy * up.y + vz * up.z;
      const el = Math.atan2(u, Math.hypot(e, nn)) * RAD;
      if (el < -10) return false; // below any lunar horizon
      const az = Math.atan2(e, nn) * RAD;
      return el >= cellHorizonAt(h, idx, az - gn);
    };
    let ns = 0,
      ne = 0;
    for (let i = 0; i < m; i++) {
      if (visible(sx[i], sy[i], sz[i])) ns++;
      if (visible(ex[i], ey[i], ez[i])) ne++;
    }
    sun[idx] = ns / Math.max(1, m);
    earth[idx] = ne / Math.max(1, m);
  }
  return {
    sun,
    earth,
    samples: m,
    startMs: sky[0]?.timeMs ?? 0,
    endMs: sky[m - 1]?.timeMs ?? 0,
  };
}

export interface TiledIlluminationStats extends TileLoadStats {
  computeMs: number;
}

/**
 * Cell horizons of the map around a site from DEM tiles: finds the tiles of
 * both local grids, loads the missing ones, then runs computeCellHorizons.
 * Throws if a tile fails or a sample reads a pixel that is not loaded.
 */
export async function computeTiledIllumination(
  o: TiledHorizonOptions & {
    onCompute?: (phase: "grid" | "horizons", done: number, total: number) => void;
  },
): Promise<{ horizons: CellHorizons; stats: TiledIlluminationStats }> {
  const now = o.now ?? (() => Date.now());
  const need = collectTiles(o.manifest, (visit) =>
    forEachIlluminationSample(o.lat, o.lon, visit),
  );
  const load = await loadTiles(o, need);
  const t1 = now();
  const { near, far, missing } = tiledDems(o.manifest, o.stores, need);
  const horizons = computeCellHorizons({ near, far }, o.siteId, o.lat, o.lon, {
    onProgress: o.onCompute,
  });
  const m = missing();
  if (m > 0) throw new Error(`map read ${m} pixels outside the loaded tiles`);
  return { horizons, stats: { ...load, computeMs: now() - t1 } };
}
