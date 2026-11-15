"use client";

import {
  POLAR_GLB_CUT_DEG,
  POLAR_PATCH_EDGE_DEG,
  SVS_GLB_ROTATION_Y,
  type Pole,
  type PolarPatchMesh,
} from "@lunar/core";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { SVS_GLB_FIT } from "@/lib/svsGlb";
import { loadPolarPatch } from "@/lib/terrainHorizon";

const DEG = Math.PI / 180;
const POLES: Pole[] = ["south", "north"];
const CUT_SIN = Math.sin(POLAR_GLB_CUT_DEG * DEG);

/**
 * NASA SVS "Moon_NASA_LRO_8k_Topo" model (LROC color + LOLA relief), web-optimized
 * by scripts/src/optimize-glb.ts.
 *
 * The vertex shader undoes the model's baked ≈1.7× relief and slightly prolate
 * base shape (see lib/svsGlb.ts) and rebuilds the surface on a unit sphere with
 * the user's exaggeration: r = 1 + k · h / 1737.4 km (k = 1 is real relief).
 * Normals are re-tilted by k / 1.7 so crater shading follows the exaggeration.
 *
 * Poleward of 80.4° the model's latitude/longitude mesh shows a radial fan of
 * sliver triangles, so once the polar caps built from the LOLA polar DEM tiles
 * have loaded (packages/core/src/polarPatch.ts), the model is cut there and
 * the caps are drawn with the same colour map. Until then, or if the tiles
 * fail, the model is shown whole.
 */
export function MoonModel({
  url,
  exaggeration,
  patchStride = 1,
}: {
  url: string;
  exaggeration: number;
  /** DEM pixels per cap vertex: 1 (≈ 950 m) on the full model, 2 on the lite one. */
  patchStride?: number;
}) {
  const gltf = useGLTF(url, false, true);

  const { mesh, map } = useMemo(() => {
    let src: THREE.Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!src && (o as THREE.Mesh).isMesh) src = o as THREE.Mesh;
    });
    if (!src) throw new Error("Moon model has no mesh");
    const source = src as THREE.Mesh;
    gltf.scene.updateMatrixWorld(true);
    // Quantized positions are restored by the node transform; we fold that
    // transform into the shader so we can work with true model coordinates.
    const dequant = source.matrixWorld.clone();
    const srcMat = source.material as THREE.MeshStandardMaterial;
    const map = srcMat.map;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      map.needsUpdate = true;
    }
    const uniforms = {
      uExag: { value: 1 },
      uDequant: { value: dequant },
      uC0: { value: SVS_GLB_FIT.c0 },
      uC2: { value: SVS_GLB_FIT.c2 },
      uC4: { value: SVS_GLB_FIT.c4 },
      uUnitsPerKm: { value: SVS_GLB_FIT.unitsPerKm },
      uBakedExag: { value: SVS_GLB_FIT.bakedExaggeration },
      // sin(latitude) limits of the model: ±2 = no cut.
      uCutSouth: { value: -2 },
      uCutNorth: { value: 2 },
    };
    const material = new THREE.MeshStandardMaterial({
      map,
      roughness: 1,
      metalness: 0,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uExag;
uniform mat4 uDequant;
uniform float uC0;
uniform float uC2;
uniform float uC4;
uniform float uUnitsPerKm;
uniform float uBakedExag;
varying float vPolarY;`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `vec3 qPos = (uDequant * vec4(position, 1.0)).xyz;
vec3 dirP = normalize(qPos);
float s2 = dirP.y * dirP.y;
float rBase = uC0 + uC2 * s2 + uC4 * s2 * s2;
float hKm = (length(qPos) - rBase) / uUnitsPerKm;
float rNew = 1.0 + uExag * hKm / 1737.4;
vec3 nIn = normalize(mat3(uDequant) * normal);
float nRad = dot(nIn, dirP);
vec3 objectNormal = normalize(nRad * dirP + (nIn - nRad * dirP) * (uExag / uBakedExag));`,
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = dirP * rNew;
vPolarY = dirP.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform float uCutSouth;
uniform float uCutNorth;
varying float vPolarY;`,
        )
        .replace(
          "#include <clipping_planes_fragment>",
          `if (vPolarY < uCutSouth || vPolarY > uCutNorth) discard;
#include <clipping_planes_fragment>`,
        );
    };
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.userData.uniforms = uniforms;
    // Positions are rewritten in the shader, so the CPU bounding volume is wrong.
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return { mesh, map };
  }, [gltf]);

  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = meshRef.current;
    if (m) m.userData.uniforms.uExag.value = exaggeration;
  });

  useEffect(
    () => () => {
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  // Polar caps: loaded once per stride, shown as soon as each pole is ready.
  const [caps, setCaps] = useState<Partial<Record<Pole, PolarPatchMesh>>>({});
  useEffect(() => {
    let alive = true;
    for (const pole of POLES)
      loadPolarPatch(pole, patchStride)
        .then((m) => {
          if (alive) setCaps((c) => ({ ...c, [pole]: m }));
        })
        .catch((e: Error) =>
          console.warn(
            `[polar cap] ${pole}: ${e.message}; keeping the model's own pole`,
          ),
        );
    return () => {
      alive = false;
    };
  }, [patchStride]);

  const capMeshes = useMemo(
    () =>
      map
        ? POLES.flatMap((pole) => {
            const m = caps[pole];
            return m && m.spacingM ? [capMesh(m, map, mesh.userData.uniforms.uExag)] : [];
          })
        : [],
    [caps, map, mesh],
  );
  // Which poles the model must leave to the caps (applied in useFrame below).
  const cutRef = useRef({ south: false, north: false });
  useEffect(() => {
    cutRef.current = {
      south: capMeshes.some((c) => c.userData.pole === "south"),
      north: capMeshes.some((c) => c.userData.pole === "north"),
    };
    return () => {
      cutRef.current = { south: false, north: false };
      for (const c of capMeshes) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    };
  }, [capMeshes]);
  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const u = m.userData.uniforms;
    u.uCutSouth.value = cutRef.current.south ? -CUT_SIN : -2;
    u.uCutNorth.value = cutRef.current.north ? CUT_SIN : 2;
  });

  return (
    <>
      <group rotation-y={SVS_GLB_ROTATION_Y}>
        <primitive ref={meshRef} object={mesh} />
      </group>
      {capMeshes.map((c) => (
        <primitive key={c.userData.pole} object={c} />
      ))}
    </>
  );
}

/**
 * One polar cap in the scene frame: unit directions displaced by
 * uExag · height, normals re-tilted like the model's, and the model's colour
 * map sampled per fragment from latitude/longitude. The texture gradient is
 * taken on whichever longitude seam (±180° or 0°) is farther away, so the
 * mipmap level stays continuous across the date line.
 */
function capMesh(
  m: PolarPatchMesh,
  map: THREE.Texture,
  uExag: { value: number },
): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.directions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("aHeight", new THREE.BufferAttribute(m.heightsM, 1));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  const uniforms = {
    uExag,
    uMap: { value: map },
    uPoleSign: { value: m.pole === "south" ? -1 : 1 },
    uEdgeAbs: { value: Math.sin(POLAR_PATCH_EDGE_DEG * DEG) },
  };
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float aHeight;
uniform float uExag;
varying vec3 vDir;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `vec3 dirP = normalize(position);
float nRad = dot(normal, dirP);
vec3 objectNormal = normalize(nRad * dirP + (normal - nRad * dirP) * uExag);`,
      )
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = dirP * (1.0 + uExag * aHeight / 1737400.0);
vDir = dirP;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform sampler2D uMap;
uniform float uPoleSign;
uniform float uEdgeAbs;
varying vec3 vDir;`,
      )
      .replace(
        "#include <map_fragment>",
        `if (vDir.y * uPoleSign < uEdgeAbs) discard;
{
  vec3 d = normalize(vDir);
  float lon = atan(d.x, d.z);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 uvA = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  float uB = fract(lon / (2.0 * PI));
  vec2 gA = vec2(dFdx(uvA.x), dFdy(uvA.x));
  vec2 gB = vec2(dFdx(uB), dFdy(uB));
  vec2 gu = dot(gB, gB) < dot(gA, gA) ? gB : gA;
  diffuseColor *= textureGrad(uMap, uvA, vec2(gu.x, dFdx(uvA.y)), vec2(gu.y, dFdy(uvA.y)));
}`,
      );
  };
  const mesh = new THREE.Mesh(g, material);
  mesh.userData.pole = m.pole;
  // Positions are displaced in the shader, so the CPU bounds are wrong.
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}
