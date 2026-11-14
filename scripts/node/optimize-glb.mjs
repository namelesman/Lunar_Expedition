// Build web-ready versions of the NASA SVS "Moon_NASA_LRO_8k_Topo.glb" (SVS #14959).
//
// The original is ~300 MB (8.1 M triangles, float32 attributes). Browsers and
// judges' laptops cannot reasonably download that, so we derive:
//   moon-8k.glb   ~1 M triangles + 8k color texture   (desktop default)
//   moon-lite.glb ~250 k triangles + 4k color texture  (fallback / weak GPUs)
// Both use EXT_meshopt_compression + quantization (three.js decodes it with
// MeshoptDecoder). We also export a random vertex sample (uv + radius) so
// scripts/fit_glb_scale.py can recover the model's reference radius and its
// baked vertical exaggeration from LOLA.
//
// Usage:
//   node optimize-glb.mjs <input.glb> <outDir>
// Output files are git-ignored; regenerate them with this script.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, prune, quantize, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const [input, outDir] = process.argv.slice(2);
if (!input || !outDir) {
  console.error("usage: node optimize-glb.mjs <input.glb> <outDir>");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

// --- 1. vertex sample for the scale fit -------------------------------------
{
  const doc = await io.read(input);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute("POSITION").getArray();
  const uv = prim.getAttribute("TEXCOORD_0").getArray();
  const n = pos.length / 3;
  const lines = ["u,v,r"];
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 40000; k++) {
    const i = Math.floor(rand() * n);
    const r = Math.hypot(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
    lines.push(`${uv[2 * i]},${uv[2 * i + 1]},${r}`);
  }
  await writeFile(join(outDir, "glb-radius-sample.csv"), lines.join("\n"));
  console.log("wrote radius sample");
}

/** Area-weighted smooth normals on indexed geometry (keeps the mesh welded). */
function smoothNormals() {
  return (doc) => {
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION").getArray();
        const idx = prim.getIndices().getArray();
        const nrm = new Float32Array(pos.length);
        for (let t = 0; t < idx.length; t += 3) {
          const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
          const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
          const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
          const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
          for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
        }
        for (let i = 0; i < nrm.length; i += 3) {
          const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
          // Outward-facing check: flip if the normal points into the sphere.
          const s = nrm[i] * pos[i] + nrm[i + 1] * pos[i + 1] + nrm[i + 2] * pos[i + 2] < 0 ? -1 : 1;
          nrm[i] *= s / l; nrm[i + 1] *= s / l; nrm[i + 2] *= s / l;
        }
        const acc = doc.createAccessor().setType("VEC3").setArray(nrm)
          .setBuffer(doc.getRoot().listBuffers()[0]);
        prim.setAttribute("NORMAL", acc);
      }
    }
  };
}

// --- 2. optimized variants ---------------------------------------------------
const variants = [
  { name: "moon-8k.glb", ratio: 0.125, error: 0.0004, texSize: null },
  { name: "moon-lite.glb", ratio: 0.03, error: 0.002, texSize: [4096, 2048] },
];

for (const v of variants) {
  const doc = await io.read(input);
  // The source stores per-face normals, so identical positions are not shared and
  // the simplifier sees every triangle as a border. Drop normals, weld, simplify,
  // then recompute smooth normals.
  for (const p of doc.getRoot().listMeshes()[0].listPrimitives()) p.setAttribute("NORMAL", null);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: v.ratio, error: v.error, lockBorder: false }),
    smoothNormals(),
    // Positions need ~16 bits: relief is ~2% of the radius. Normals 10 bits, UVs 16 bits.
    quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 16 }),
    ...(v.texSize
      ? [textureCompress({ encoder: sharp, targetFormat: "jpeg", resize: v.texSize, quality: 88 })]
      : []),
    dedup(),
    prune(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
  });
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const tris = prim.getIndices().getCount() / 3;
  const out = join(outDir, v.name);
  await io.write(out, doc);
  const { size } = await import("node:fs").then((fs) => fs.promises.stat(out));
  console.log(`${v.name}: ${tris.toLocaleString()} triangles, ${(size / 1e6).toFixed(1)} MB`);
}
