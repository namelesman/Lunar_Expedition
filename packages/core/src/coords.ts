import { MOON_RADIUS_M, type LatLon, type Vec3 } from "./types";

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Normalize a longitude to (-180, 180]. */
export function normalizeLon(lon: number): number {
  let l = ((((lon + 180) % 360) + 360) % 360) - 180;
  if (l === -180) l = 180;
  return l;
}

/** Normalize an azimuth / angle to [0, 360). */
export function normalizeAz(az: number): number {
  return ((az % 360) + 360) % 360;
}

/**
 * Moon-fixed (Mean Earth / Polar Axis) frame used by the 3D scene:
 *   +Y = north pole, +Z = (lat 0, lon 0) — the mean sub-Earth point,
 *   +X = (lat 0, lon 90°E).
 * Seen from +Z with +Y up, east is to the right, exactly like the Moon seen
 * from Earth with north up. `radius` defaults to 1 (scene units = Moon radii).
 */
export function latLonToVector3(lat: number, lon: number, radius = 1): Vec3 {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const c = Math.cos(phi);
  return {
    x: radius * c * Math.sin(lam),
    y: radius * Math.sin(phi),
    z: radius * c * Math.cos(lam),
  };
}

export function vector3ToLatLon(v: Vec3): LatLon {
  const r = Math.hypot(v.x, v.y, v.z);
  if (r === 0) return { lat: 0, lon: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y / r))) * RAD;
  const lon = Math.atan2(v.x, v.z) * RAD;
  return { lat, lon: normalizeLon(lon) };
}

/**
 * Equirectangular texture coordinates for maps centred on longitude 0
 * (LROC / LOLA / CGI Moon Kit convention: left edge = 180°W, top = 90°N).
 * glTF convention: v = 0 at the TOP row of the image.
 */
export function latLonToUv(lat: number, lon: number): { u: number; v: number } {
  return { u: (normalizeLon(lon) + 180) / 360, v: (90 - lat) / 180 };
}

export function uvToLatLon(u: number, v: number): LatLon {
  return { lat: 90 - v * 180, lon: normalizeLon(u * 360 - 180) };
}

/**
 * The NASA SVS GLB (Moon_NASA_LRO_8k_Topo.glb) puts lon 0 on +X and 90°E on
 * −Z (north +Y). Rotating it by this angle about +Y aligns it with our frame.
 * Verified by scripts/node/analyze-glb.mjs and the unit tests.
 */
export const SVS_GLB_ROTATION_Y = -Math.PI / 2;

/** Rotate a vector about +Y (right-handed, same as three.js Object3D.rotation.y). */
export function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** Direction of the SVS GLB vertex that has texture coordinate (u, v), in the GLB's own frame. */
export function svsGlbDirectionFromUv(u: number, v: number): Vec3 {
  const { lat, lon } = uvToLatLon(u, v);
  const phi = lat * DEG;
  const lam = lon * DEG;
  return {
    x: Math.cos(phi) * Math.cos(lam),
    y: Math.sin(phi),
    z: -Math.cos(phi) * Math.sin(lam),
  };
}

/** Local East / North / Up unit vectors at a site, in the Moon-fixed frame. */
export function enuBasis(
  lat: number,
  lon: number,
): { east: Vec3; north: Vec3; up: Vec3 } {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const sp = Math.sin(phi),
    cp = Math.cos(phi),
    sl = Math.sin(lam),
    cl = Math.cos(lam);
  return {
    east: { x: cl, y: 0, z: -sl },
    north: { x: -sp * sl, y: cp, z: -sp * cl },
    up: { x: cp * sl, y: sp, z: cp * cl },
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function normalize(v: Vec3): Vec3 {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / r, y: v.y / r, z: v.z / r };
}

/** Azimuth (from north, clockwise) and elevation of a direction seen from a site. */
export function directionToAzEl(
  lat: number,
  lon: number,
  dir: Vec3,
): { azimuthDeg: number; elevationDeg: number } {
  const d = normalize(dir);
  const { east, north, up } = enuBasis(lat, lon);
  const e = dot(d, east),
    n = dot(d, north),
    u = dot(d, up);
  return {
    azimuthDeg: normalizeAz(Math.atan2(e, n) * RAD),
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, u))) * RAD,
  };
}

/** Great-circle distance between two points on the reference sphere, meters. */
export function greatCircleDistanceM(
  a: LatLon,
  b: LatLon,
  radiusM = MOON_RADIUS_M,
): number {
  const p1 = a.lat * DEG,
    p2 = b.lat * DEG;
  const dp = p2 - p1,
    dl = (b.lon - a.lon) * DEG;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point reached from `start` after `distanceM` along initial bearing `azimuthDeg`. */
export function destinationPoint(
  start: LatLon,
  azimuthDeg: number,
  distanceM: number,
  radiusM = MOON_RADIUS_M,
): LatLon {
  const d = distanceM / radiusM;
  const p1 = start.lat * DEG,
    l1 = start.lon * DEG,
    b = azimuthDeg * DEG;
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return { lat: p2 * RAD, lon: normalizeLon(l2 * RAD) };
}

/**
 * Azimuthal-equidistant projection centred at `center` (meters east/north).
 * Used by terrain grids: well-behaved at the poles.
 */
export function latLonToLocalM(
  center: LatLon,
  p: LatLon,
  radiusM = MOON_RADIUS_M,
): { x: number; y: number } {
  const d = greatCircleDistanceM(center, p, radiusM);
  if (d === 0) return { x: 0, y: 0 };
  const p1 = center.lat * DEG,
    p2 = p.lat * DEG,
    dl = (p.lon - center.lon) * DEG;
  const az = Math.atan2(
    Math.sin(dl) * Math.cos(p2),
    Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl),
  );
  return { x: d * Math.sin(az), y: d * Math.cos(az) };
}

export function localMToLatLon(
  center: LatLon,
  x: number,
  y: number,
  radiusM = MOON_RADIUS_M,
): LatLon {
  const d = Math.hypot(x, y);
  if (d === 0) return { lat: center.lat, lon: center.lon };
  return destinationPoint(center, Math.atan2(x, y) * RAD, d, radiusM);
}
