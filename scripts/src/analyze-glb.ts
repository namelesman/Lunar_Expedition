/**
 * Inspect the NASA SVS GLB: radius statistics and the axes implied by its UVs.
 *
 * Usage: npm run glb:analyze -w @lunar/scripts -- <path-to-Moon_NASA_LRO_8k_Topo.glb>
 */
import { resolve } from "node:path";
import { NodeIO, type Primitive } from "@gltf-transform/core";

function attribute(prim: Primitive, name: string) {
  const arr = prim.getAttribute(name)?.getArray();
  if (!arr) throw new Error(`primitive has no ${name}`);
  return arr;
}

const path = process.argv[2];
if (!path) throw new Error("usage: analyze-glb.ts <glb>");
const doc = await new NodeIO().read(
  resolve(process.env.INIT_CWD ?? process.cwd(), path),
);
const root = doc.getRoot();
for (const node of root.listNodes()) {
  console.log(
    "node",
    node.getName(),
    "T",
    node.getTranslation(),
    "R",
    node.getRotation(),
    "S",
    node.getScale(),
  );
}
const prim = root.listMeshes()[0].listPrimitives()[0];
const pos = attribute(prim, "POSITION");
const uv = attribute(prim, "TEXCOORD_0");
const n = pos.length / 3;
let rmin = Infinity,
  rmax = -Infinity,
  rsum = 0;
const radii = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const r = Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
  radii[i] = r;
  rsum += r;
  if (r < rmin) rmin = r;
  if (r > rmax) rmax = r;
}
const sorted = Float32Array.from(radii).sort();
console.log({
  vertices: n,
  rmin,
  rmax,
  rmean: rsum / n,
  rmedian: sorted[n >> 1],
});

function near(u0: number, v0: number) {
  let best = -1,
    bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (uv[2 * i] - u0) ** 2 + (uv[2 * i + 1] - v0) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const p = [pos[3 * best], pos[3 * best + 1], pos[3 * best + 2]];
  const r = Math.hypot(p[0], p[1], p[2]);
  return {
    uv: [uv[2 * best], uv[2 * best + 1]],
    dir: p.map((c) => +(c / r).toFixed(4)),
  };
}
console.log("lon0 lat0   (u.5 v.5) ", near(0.5, 0.5));
console.log("lon90E      (u.75 v.5)", near(0.75, 0.5));
console.log("lon180      (u0 v.5)  ", near(0.001, 0.5));
console.log("north pole  (v0)      ", near(0.5, 0.001));
console.log("south pole  (v1)      ", near(0.5, 0.999));
