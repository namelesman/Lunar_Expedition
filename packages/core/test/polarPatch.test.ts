import { describe, expect, it } from "vitest";
import {
  arrayPixels,
  buildPolarPatch,
  POLAR_PATCH_EDGE_DEG,
  polarPatchTiles,
  tileCols,
  tileRows,
  vector3ToLatLon,
  type DemManifest,
  type PolarLayerSpec,
} from "../src";

// A synthetic south polar layer like polar-s-960m: 953 px of 960 m, down to 75°S.
const spec: PolarLayerSpec = {
  kind: "polar-stereo",
  id: "polar-s-960m",
  name: "synthetic",
  dtype: "int16",
  tilePx: 128,
  pole: "south",
  size: 953,
  center: 476,
  scaleM: 960,
  edgeLat: -75,
  scale: 0.5,
};
const manifest: DemManifest = {
  version: 1,
  tilesDir: "v1/",
  near: [],
  far: ["polar-s-960m"],
  layers: { "polar-s-960m": spec },
  generatedBy: "test",
};

function raster(f: (x: number, y: number) => number): Int16Array {
  const a = new Int16Array(spec.size * spec.size);
  for (let y = 0; y < spec.size; y++)
    for (let x = 0; x < spec.size; x++) a[y * spec.size + x] = f(x, y);
  return a;
}

describe("polar caps", () => {
  it("needs only the tiles around the pole", () => {
    const need = polarPatchTiles(manifest, "south").get("polar-s-960m")!;
    expect(need.size).toBeGreaterThan(20);
    expect(need.size).toBeLessThan(tileCols(spec) * tileRows(spec));
    // The tile holding the pole is in, a corner tile is not.
    expect(need.has(3 * tileCols(spec) + 3)).toBe(true);
    expect(need.has(0)).toBe(false);
  });

  it("puts vertices on the pole cap with LOLA heights and outward normals", () => {
    const flat = buildPolarPatch(spec, arrayPixels(raster(() => 2000), spec.size));
    const n = flat.heightsM.length;
    expect(flat.spacingM).toBe(960);
    let minLatUsed = 0;
    let maxLatUsed = -90;
    let worstLen = 0;
    let minDot = 1;
    const heights = new Set<number>();
    const used = new Set(flat.index);
    for (const k of used) {
      const d = { x: flat.directions[k * 3], y: flat.directions[k * 3 + 1], z: flat.directions[k * 3 + 2] };
      worstLen = Math.max(worstLen, Math.abs(Math.hypot(d.x, d.y, d.z) - 1));
      heights.add(flat.heightsM[k]);
      const { lat } = vector3ToLatLon(d);
      minLatUsed = Math.min(minLatUsed, lat);
      maxLatUsed = Math.max(maxLatUsed, lat);
      // Flat terrain: the normal is the radial direction.
      minDot = Math.min(
        minDot,
        d.x * flat.normals[k * 3] + d.y * flat.normals[k * 3 + 1] + d.z * flat.normals[k * 3 + 2],
      );
    }
    expect(worstLen).toBeLessThan(1e-6);
    expect([...heights]).toEqual([1000]); // int16 × 0.5 m
    expect(minDot).toBeGreaterThan(0.9999);
    expect(minLatUsed).toBeLessThan(-89.9);
    // The cap reaches the edge latitude, with at most a couple of cells of margin.
    expect(maxLatUsed).toBeGreaterThan(-POLAR_PATCH_EDGE_DEG);
    expect(maxLatUsed).toBeLessThan(-POLAR_PATCH_EDGE_DEG + 0.1);
    // About π r² cells, two triangles each.
    const rPx = (2 * 1737.4e3 * Math.tan((10 / 2) * (Math.PI / 180))) / 960;
    expect(flat.index.length / 6).toBeGreaterThan(Math.PI * rPx * rPx * 0.98);
    expect(flat.index.length / 6).toBeLessThan(Math.PI * (rPx + 3) ** 2);
    expect(n).toBeGreaterThan(flat.index.length / 6);
  });

  it("winds triangles outward and tilts normals down the slope", () => {
    // Elevation rising along +x (towards lon 90°E): 0.5 m per pixel × 2 = 1 m / 960 m.
    const mesh = buildPolarPatch(spec, arrayPixels(raster((x) => (x - 476) * 2), spec.size), 2);
    expect(mesh.spacingM).toBe(1920);
    const { directions: D, index: I } = mesh;
    for (let t = 0; t < I.length; t += 3 * 997) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const u = [D[b * 3] - D[a * 3], D[b * 3 + 1] - D[a * 3 + 1], D[b * 3 + 2] - D[a * 3 + 2]];
      const v = [D[c * 3] - D[a * 3], D[c * 3 + 1] - D[a * 3 + 1], D[c * 3 + 2] - D[a * 3 + 2]];
      const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(nrm[0] * D[a * 3] + nrm[1] * D[a * 3 + 1] + nrm[2] * D[a * 3 + 2]).toBeGreaterThan(0);
    }
    // At the pole, the uphill direction is +x (scene), so the normal leans to −x by ~1/960.
    const half = (Math.sqrt(mesh.heightsM.length) - 1) / 2;
    const k = half * (2 * half + 1) + half;
    expect(mesh.directions[k * 3 + 1]).toBeCloseTo(-1, 6);
    expect(mesh.normals[k * 3] / mesh.normals[k * 3 + 1]).toBeCloseTo(1 / 960, 4);
  });

  it("fails loudly when a pixel inside the cap is missing", () => {
    const holes = { pixel: (x: number, y: number) => (x === 476 && y === 476 ? NaN : 0) };
    expect(() => buildPolarPatch(spec, holes)).toThrow(/no elevation/);
  });
});
