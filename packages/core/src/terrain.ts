/**
 * Terrain horizons from LOLA digital elevation models.
 *
 * One implementation for both consumers:
 *  - the offline pipeline (scripts/src/horizons.ts) samples whole NASA rasters;
 *  - the browser (Web Worker) samples the same rasters cut into tiles
 *    (demTiles.ts).
 * The sampling math reads pixels through a PixelSource, so a full raster and a
 * tiled copy of it return bit-identical heights. Pure code: no Node or DOM APIs.
 */
import { DEG, destinationPoint } from "./coords";
import { MOON_RADIUS_M, type HorizonMask, type LatLon } from "./types";

export interface DemSampler {
  readonly name: string;
  /** Height (m, relative to the 1737.4 km sphere) at lat/lon, or NaN outside coverage. */
  sample(lat: number, lon: number): number;
}

/** Integer pixel access; NaN when the pixel is not available (e.g. tile not loaded). */
export interface PixelSource {
  pixel(x: number, y: number): number;
}

/** Row-major array of a whole raster. */
export function arrayPixels(
  data: ArrayLike<number>,
  width: number,
): PixelSource {
  return { pixel: (x, y) => data[y * width + x] };
}

/** Visits the integer pixel coordinates read by one bilinear sample. */
export type PixelVisitor = (x: number, y: number) => void;

/**
 * Equirectangular raster: lon −180 at the left edge, row 0 = 90N,
 * height = dn · scale + offset. Bilinear, wraps in longitude, clamps in latitude.
 */
export interface EquirectGrid {
  width: number;
  height: number;
  /** Pixels per degree. */
  ppd: number;
  scale: number;
  offset: number;
}

export class EquirectDem implements DemSampler {
  constructor(
    readonly name: string,
    readonly grid: EquirectGrid,
    readonly pixels: PixelSource,
  ) {}

  sample(lat: number, lon: number): number {
    const { width: W, height: H, ppd } = this.grid;
    const x = ((((lon + 180) % 360) + 360) % 360) * ppd - 0.5;
    let y = (90 - lat) * ppd - 0.5;
    y = Math.min(Math.max(y, 0), H - 1.000001);
    let x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0;
    x0 = ((x0 % W) + W) % W;
    const x1 = (x0 + 1) % W;
    const y1 = Math.min(y0 + 1, H - 1);
    const p = this.pixels;
    const v =
      (p.pixel(x0, y0) * (1 - fx) + p.pixel(x1, y0) * fx) * (1 - fy) +
      (p.pixel(x0, y1) * (1 - fx) + p.pixel(x1, y1) * fx) * fy;
    return v * this.grid.scale + this.grid.offset;
  }

  /** Pixels that sample(lat, lon) reads. Always covered: returns true. */
  footprint(lat: number, lon: number, visit: PixelVisitor): boolean {
    const { width: W, height: H, ppd } = this.grid;
    const x = ((((lon + 180) % 360) + 360) % 360) * ppd - 0.5;
    let y = (90 - lat) * ppd - 0.5;
    y = Math.min(Math.max(y, 0), H - 1.000001);
    const x0 = ((Math.floor(x) % W) + W) % W;
    const x1 = (x0 + 1) % W;
    const y0 = Math.floor(y);
    const y1 = Math.min(y0 + 1, H - 1);
    visit(x0, y0);
    visit(x1, y0);
    visit(x0, y1);
    visit(x1, y1);
    return true;
  }
}

/**
 * Polar stereographic raster.
 *  south (LOLA GDR convention, see scripts/src/lib/dem.ts):
 *    rho = 2R tan(pi/4 + lat/2), x = rho sin(lon), y = rho cos(lon), covers lat ≤ edgeLat
 *  north (LOLA GDR north convention):
 *    rho = 2R tan(pi/4 − lat/2), x = rho sin(lon), y = −rho cos(lon), covers lat ≥ edgeLat
 *  col = center + x/scaleM, row = center − y/scaleM, height = dn · scale.
 * NaN outside the covered cap and on the outer pixel ring.
 */
export interface PolarGrid {
  pole: "south" | "north";
  size: number;
  center: number;
  scaleM: number;
  /** Latitude that bounds the covered cap (south: lat ≤ edgeLat, north: lat ≥ edgeLat). */
  edgeLat: number;
  scale: number;
}

export class PolarStereoDem implements DemSampler {
  private col = 0;
  private row = 0;

  constructor(
    readonly name: string,
    readonly grid: PolarGrid,
    readonly pixels: PixelSource,
  ) {}

  /** Fractional pixel of lat/lon into this.col/this.row; false outside coverage. */
  private locate(lat: number, lon: number): boolean {
    const g = this.grid;
    if (g.pole === "south") {
      if (lat > g.edgeLat) return false;
      const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + (lat * DEG) / 2);
      this.col = g.center + (rho * Math.sin(lon * DEG)) / g.scaleM;
      this.row = g.center - (rho * Math.cos(lon * DEG)) / g.scaleM;
    } else {
      if (lat < g.edgeLat) return false;
      const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 - (lat * DEG) / 2);
      this.col = g.center + (rho * Math.sin(lon * DEG)) / g.scaleM;
      this.row = g.center + (rho * Math.cos(lon * DEG)) / g.scaleM;
    }
    const c0 = Math.floor(this.col),
      r0 = Math.floor(this.row);
    // Stay one pixel inside the edge (the corners beyond the cap are not used).
    return !(c0 < 1 || r0 < 1 || c0 >= g.size - 2 || r0 >= g.size - 2);
  }

  sample(lat: number, lon: number): number {
    if (!this.locate(lat, lon)) return NaN;
    const c0 = Math.floor(this.col),
      r0 = Math.floor(this.row);
    const fc = this.col - c0,
      fr = this.row - r0;
    const p = this.pixels;
    const v =
      (p.pixel(c0, r0) * (1 - fc) + p.pixel(c0 + 1, r0) * fc) * (1 - fr) +
      (p.pixel(c0, r0 + 1) * (1 - fc) + p.pixel(c0 + 1, r0 + 1) * fc) * fr;
    return v * this.grid.scale;
  }

  /** Pixels that sample(lat, lon) reads; false when the point is outside coverage. */
  footprint(lat: number, lon: number, visit: PixelVisitor): boolean {
    if (!this.locate(lat, lon)) return false;
    const c0 = Math.floor(this.col),
      r0 = Math.floor(this.row);
    visit(c0, r0);
    visit(c0 + 1, r0);
    visit(c0, r0 + 1);
    visit(c0 + 1, r0 + 1);
    return true;
  }
}

/** Stereographic radius (m) of a latitude on a polar grid. */
export function polarRho(g: Pick<PolarGrid, "pole">, lat: number): number {
  const t = g.pole === "south" ? Math.PI / 4 + (lat * DEG) / 2 : Math.PI / 4 - (lat * DEG) / 2;
  return 2 * MOON_RADIUS_M * Math.tan(t);
}

/** Lat/lon of a (fractional) pixel of a polar grid: inverse of PolarStereoDem. */
export function polarPixelToLatLon(
  g: PolarGrid,
  col: number,
  row: number,
): LatLon {
  const x = (col - g.center) * g.scaleM;
  const y = (g.center - row) * g.scaleM;
  const a = (2 * Math.atan(Math.hypot(x, y) / (2 * MOON_RADIUS_M))) / DEG;
  return g.pole === "south"
    ? { lat: a - 90, lon: Math.atan2(x, y) / DEG }
    : { lat: 90 - a, lon: Math.atan2(x, -y) / DEG };
}

/** First sampler (finest first) that covers the point; counts which one was used. */
export class LayeredDem implements DemSampler {
  readonly used: number[];
  constructor(readonly layers: DemSampler[]) {
    this.used = layers.map(() => 0);
  }
  get name(): string {
    return this.layers.map((l) => l.name).join(" + ");
  }
  sample(lat: number, lon: number): number {
    for (let i = 0; i < this.layers.length; i++) {
      const v = this.layers[i].sample(lat, lon);
      if (!Number.isNaN(v)) {
        this.used[i]++;
        return v;
      }
    }
    return NaN;
  }
  resetUsage(): void {
    this.used.fill(0);
  }
}

/** Observer eye height above the local terrain (a lander camera / antenna). */
export const HORIZON_OBSERVER_HEIGHT_M = 2;
export const HORIZON_AZIMUTH_STEP_DEG = 0.5;
export const HORIZON_MAX_KM = 300;
/** Up to this distance the march samples the `near` DEM, beyond it the `far` one. */
export const HORIZON_NEAR_KM = 50;

/** Distances (m) of the terrain samples along each azimuth: dense near the site. */
export function marchDistancesM(): number[] {
  const d: number[] = [];
  for (let x = 60; x < 5_000; x += 60) d.push(x);
  for (let x = 5_000; x < 50_000; x += 250) d.push(x);
  for (let x = 50_000; x <= HORIZON_MAX_KM * 1000; x += 1_000) d.push(x);
  return d;
}

/**
 * Visits every terrain sample of the horizon march (same geometry as
 * horizonMask). Used to find exactly which DEM tiles a site needs.
 */
export function forEachHorizonSample(
  lat: number,
  lon: number,
  visit: (p: LatLon, distanceM: number) => void,
): void {
  const dist = marchDistancesM();
  for (let az = 0; az < 360; az += HORIZON_AZIMUTH_STEP_DEG) {
    for (const d of dist) {
      visit(destinationPoint({ lat, lon }, az, d, MOON_RADIUS_M), d);
    }
  }
}

/** DEMs for the horizon march: `near` up to HORIZON_NEAR_KM, `far` beyond (defaults to near). */
export interface HorizonDems {
  near: DemSampler;
  far?: DemSampler;
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * Terrain horizon mask of a site. For each azimuth (0.5° steps) we march along
 * the great circle up to 300 km and keep the highest elevation angle of the
 * terrain seen by an observer 2 m above the ground. Curvature is exact:
 *
 *   observer radius r0 = R + h_site + OBS_H, target radius r1 = R + h(d)
 *   central angle   t  = d / R
 *   elevation       e  = atan2(r1·cos t − r0, r1·sin t)
 *
 * No atmosphere on the Moon, so there is no refraction term: the horizon is the
 * terrain (or the limb of the sphere, which this formula also yields).
 */
export function horizonMask(
  dems: HorizonDems,
  siteId: string,
  lat: number,
  lon: number,
): HorizonMask {
  const R = MOON_RADIUS_M;
  const near = dems.near;
  const far = dems.far ?? near;
  const nearM = HORIZON_NEAR_KM * 1000;
  const h0 = near.sample(lat, lon);
  const r0 = R + h0 + HORIZON_OBSERVER_HEIGHT_M;
  const dist = marchDistancesM();
  const elevationsDeg: number[] = [];
  const distancesKm: number[] = [];
  for (let az = 0; az < 360; az += HORIZON_AZIMUTH_STEP_DEG) {
    let best = -Infinity,
      bestD = 0;
    for (const d of dist) {
      const p = destinationPoint({ lat, lon }, az, d, R);
      const r1 = R + (d <= nearM ? near : far).sample(p.lat, p.lon);
      const t = d / R;
      const e = Math.atan2(r1 * Math.cos(t) - r0, r1 * Math.sin(t));
      if (e > best) {
        best = e;
        bestD = d;
      }
    }
    elevationsDeg.push(round((best * 180) / Math.PI, 3));
    distancesKm.push(round(bestD / 1000, 2));
  }
  return {
    siteId,
    lat,
    lon,
    observerHeightM: HORIZON_OBSERVER_HEIGHT_M,
    siteElevationM: round(h0, 1),
    azimuthStepDeg: HORIZON_AZIMUTH_STEP_DEG,
    elevationsDeg,
    distancesKm,
    maxDistanceKm: HORIZON_MAX_KM,
    demSource:
      far === near
        ? near.name
        : `${near.name} within ${HORIZON_NEAR_KM} km; ${far.name} ${HORIZON_NEAR_KM}–${HORIZON_MAX_KM} km`,
  };
}
