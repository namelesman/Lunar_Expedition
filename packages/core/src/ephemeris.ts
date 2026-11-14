import * as Astronomy from "astronomy-engine";
import {
  DEG,
  RAD,
  directionToAzEl,
  normalize,
  normalizeLon,
  vector3ToLatLon,
} from "./coords";
import type {
  Body,
  BodyPosition,
  HorizonMask,
  LatLon,
  SunInfo,
  Vec3,
} from "./types";

const AU_KM = 149_597_870.7;
export const SUN_RADIUS_KM = 695_700;
export const EARTH_RADIUS_KM = 6_371.0;

/**
 * Geometry of Sun and Earth as seen from the Moon at one instant, expressed in
 * the Moon-fixed frame of the scene (+Y north, +Z lon 0, +X lon 90°E).
 * Independent of the site, so it is computed once per time step.
 */
export interface MoonSkyState {
  timeMs: number;
  /** Unit vector Moon centre → Sun (Moon-fixed). */
  sunDir: Vec3;
  /** Unit vector Moon centre → Earth (Moon-fixed). */
  earthDir: Vec3;
  sunDistanceKm: number;
  earthDistanceKm: number;
}

/**
 * EQJ (J2000 equatorial) → Moon body-fixed, using the IAU WGCCRE 2015 lunar
 * rotation model as implemented by astronomy-engine (pole α0, δ0 and prime
 * meridian angle W, including the libration terms E1…E13). This approximates
 * the Mean Earth / Polar Axis frame used by LOLA and LROC to ~0.01°.
 *
 *   v_bf = Rz(W) · Rx(90° − δ0) · Rz(90° + α0) · v_eqj
 * then mapped to scene axes: x = bf.y (90°E), y = bf.z (north), z = bf.x (lon 0).
 */
function eqjToMoonFixed(v: Vec3, axis: Astronomy.AxisInfo): Vec3 {
  const a = (axis.ra * 15 + 90) * DEG;
  const b = (90 - axis.dec) * DEG;
  const w = axis.spin * DEG;
  // Rz(a)
  let x = Math.cos(a) * v.x + Math.sin(a) * v.y;
  let y = -Math.sin(a) * v.x + Math.cos(a) * v.y;
  let z = v.z;
  // Rx(b)
  const y2 = Math.cos(b) * y + Math.sin(b) * z;
  const z2 = -Math.sin(b) * y + Math.cos(b) * z;
  y = y2;
  z = z2;
  // Rz(w)
  const x3 = Math.cos(w) * x + Math.sin(w) * y;
  const y3 = -Math.sin(w) * x + Math.cos(w) * y;
  x = x3;
  y = y3;
  return { x: y, y: z, z: x };
}

export function moonSkyState(time: Date | number): MoonSkyState {
  const date = typeof time === "number" ? new Date(time) : time;
  const t = Astronomy.MakeTime(date);
  const moon = Astronomy.GeoMoon(t); // Earth → Moon, EQJ, AU
  const sun = Astronomy.GeoVector(Astronomy.Body.Sun, t, false); // Earth → Sun, EQJ, AU
  const axis = Astronomy.RotationAxis(Astronomy.Body.Moon, t);
  const toSun = { x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z };
  const toEarth = { x: -moon.x, y: -moon.y, z: -moon.z };
  const sunDistanceKm = Math.hypot(toSun.x, toSun.y, toSun.z) * AU_KM;
  const earthDistanceKm = Math.hypot(toEarth.x, toEarth.y, toEarth.z) * AU_KM;
  return {
    timeMs: date.getTime(),
    sunDir: normalize(eqjToMoonFixed(toSun, axis)),
    earthDir: normalize(eqjToMoonFixed(toEarth, axis)),
    sunDistanceKm,
    earthDistanceKm,
  };
}

/** Elevation of the terrain horizon at an azimuth (linear interpolation, wraps at 360°). */
export function horizonElevationAt(
  mask: HorizonMask | null | undefined,
  azimuthDeg: number,
): number {
  if (!mask || mask.elevationsDeg.length === 0) return 0;
  const n = mask.elevationsDeg.length;
  const f = (((azimuthDeg / mask.azimuthStepDeg) % n) + n) % n;
  const i0 = Math.floor(f);
  const i1 = (i0 + 1) % n;
  const w = f - i0;
  return mask.elevationsDeg[i0] * (1 - w) + mask.elevationsDeg[i1] * w;
}

/**
 * Fraction (0..1) of a disk of angular radius `radiusDeg` centred at
 * `elevationDeg` that lies above a horizon at `horizonDeg` (straight chord).
 */
export function diskFractionAbove(
  elevationDeg: number,
  horizonDeg: number,
  radiusDeg: number,
): number {
  const d = (horizonDeg - elevationDeg) / radiusDeg;
  if (d <= -1) return 1;
  if (d >= 1) return 0;
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

/**
 * Topocentric direction from a surface site to a distant body. Corrects the
 * Moon-centre direction for the site's offset from the centre (parallax:
 * up to ~0.95° for Earth, negligible for the Sun).
 */
function topocentric(
  site: LatLon,
  siteRadiusKm: number,
  dir: Vec3,
  distanceKm: number,
): { dir: Vec3; distanceKm: number } {
  const phi = site.lat * DEG;
  const lam = site.lon * DEG;
  const sx = siteRadiusKm * Math.cos(phi) * Math.sin(lam);
  const sy = siteRadiusKm * Math.sin(phi);
  const sz = siteRadiusKm * Math.cos(phi) * Math.cos(lam);
  const v = {
    x: dir.x * distanceKm - sx,
    y: dir.y * distanceKm - sy,
    z: dir.z * distanceKm - sz,
  };
  const d = Math.hypot(v.x, v.y, v.z);
  return { dir: { x: v.x / d, y: v.y / d, z: v.z / d }, distanceKm: d };
}

export function bodyPositionAt(
  body: Body,
  site: LatLon,
  sky: MoonSkyState,
  mask?: HorizonMask | null,
): BodyPosition {
  const siteRadiusKm = 1737.4 + (mask?.siteElevationM ?? 0) / 1000;
  const raw = body === "sun" ? sky.sunDir : sky.earthDir;
  const rawDist = body === "sun" ? sky.sunDistanceKm : sky.earthDistanceKm;
  const { dir, distanceKm } = topocentric(site, siteRadiusKm, raw, rawDist);
  const { azimuthDeg, elevationDeg } = directionToAzEl(site.lat, site.lon, dir);
  const angularRadiusDeg =
    Math.asin((body === "sun" ? SUN_RADIUS_KM : EARTH_RADIUS_KM) / distanceKm) *
    RAD;
  const terrainHorizonDeg = horizonElevationAt(mask, azimuthDeg);
  return {
    body,
    azimuthDeg,
    elevationDeg,
    distanceKm,
    angularRadiusDeg,
    directionMoonFixed: dir,
    terrainHorizonDeg,
    visibleFraction: diskFractionAbove(
      elevationDeg,
      terrainHorizonDeg,
      angularRadiusDeg,
    ),
  };
}

export function sunInfo(
  siteId: string,
  site: LatLon,
  time: Date | number,
  mask?: HorizonMask | null,
): SunInfo {
  const sky = moonSkyState(time);
  return {
    siteId,
    time: new Date(sky.timeMs).toISOString(),
    sun: bodyPositionAt("sun", site, sky, mask),
    earth: bodyPositionAt("earth", site, sky, mask),
    sunDirectionMoonFixed: sky.sunDir,
    subSolarPoint: vector3ToLatLon(sky.sunDir),
    subEarthPoint: vector3ToLatLon(sky.earthDir),
  };
}

/** Sub-solar / sub-Earth point helpers (lon normalized to (-180, 180]). */
export function subPoint(dir: Vec3): LatLon {
  const p = vector3ToLatLon(dir);
  return { lat: p.lat, lon: normalizeLon(p.lon) };
}
