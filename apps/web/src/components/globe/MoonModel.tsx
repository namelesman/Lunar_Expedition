"use client";

import { SVS_GLB_ROTATION_Y } from "@lunar/core";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SVS_GLB_FIT } from "@/lib/svsGlb";

/**
 * NASA SVS "Moon_NASA_LRO_8k_Topo" model (LROC color + LOLA relief), web-optimized
 * by scripts/node/optimize-glb.mjs.
 *
 * The vertex shader undoes the model's baked ≈1.7× relief and slightly prolate
 * base shape (see lib/svsGlb.ts) and rebuilds the surface on a unit sphere with
 * the user's exaggeration: r = 1 + k · h / 1737.4 km (k = 1 is real relief).
 * Normals are re-tilted by k / 1.7 so crater shading follows the exaggeration.
 */
export function MoonModel({
  url,
  exaggeration,
}: {
  url: string;
  exaggeration: number;
}) {
  const gltf = useGLTF(url, false, true);

  const { mesh } = useMemo(() => {
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
uniform float uBakedExag;`,
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
        .replace("#include <begin_vertex>", "vec3 transformed = dirP * rNew;");
    };
    const mesh = new THREE.Mesh(source.geometry, material);
    mesh.userData.uniforms = uniforms;
    // Positions are rewritten in the shader, so the CPU bounding volume is wrong.
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    return { mesh };
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

  return (
    <group rotation-y={SVS_GLB_ROTATION_Y}>
      <primitive ref={meshRef} object={mesh} />
    </group>
  );
}
