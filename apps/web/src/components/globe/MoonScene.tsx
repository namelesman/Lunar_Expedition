"use client";

import { latLonToVector3, vector3ToLatLon, type Vec3 } from "@lunar/core";
import { Stars } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { assetUrl } from "@/lib/assets";
import { useApp } from "@/lib/store";
import { MOON_MODELS } from "@/lib/svsGlb";
import { CameraRig } from "./CameraRig";
import { FallbackMoon, ModelErrorBoundary } from "./FallbackMoon";
import { MoonModel } from "./MoonModel";
import { SiteMarkers } from "./SiteMarkers";

const START = latLonToVector3(-30, 10, 3.4);

export interface MoonSceneProps {
  /** Unit vector toward the Sun in the Moon-fixed frame. */
  sunDirection: Vec3;
  /** Called with the lat/lon of a double-clicked surface point. */
  onPickSurface?: (lat: number, lon: number) => void;
  /** Reports GPU limits so the app can pick the model quality. */
  onCapabilities?: (maxTextureSize: number) => void;
}

export default function MoonScene({ sunDirection, onPickSurface, onCapabilities }: MoonSceneProps) {
  const exaggeration = useApp((s) => s.exaggeration);
  const quality = useApp((s) => s.quality);
  const sun = useMemo(
    () => new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z).normalize().multiplyScalar(20),
    [sunDirection.x, sunDirection.y, sunDirection.z],
  );

  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const { lat, lon } = vector3ToLatLon(e.point);
    onPickSurface?.(lat, lon);
  };

  return (
    <Canvas
      camera={{ position: [START.x, START.y, START.z], fov: 45, near: 0.01, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true, logarithmicDepthBuffer: false }}
      onCreated={({ gl }) => onCapabilities?.(gl.capabilities.maxTextureSize)}
    >
      <color attach="background" args={["#000000"]} />
      <Stars radius={40} depth={20} count={5000} factor={2.2} saturation={0} fade speed={0} />
      {/* Faint fill so the night side is not pure black (earthshine-like). */}
      <ambientLight intensity={0.035} />
      <directionalLight position={sun} intensity={3.2} />
      <ModelErrorBoundary
        fallback={
          <Suspense fallback={<LoadingSphere />}>
            <FallbackMoon />
          </Suspense>
        }
      >
        <Suspense fallback={<LoadingSphere />}>
          <MoonModel url={assetUrl(MOON_MODELS[quality].file)} exaggeration={exaggeration} />
        </Suspense>
      </ModelErrorBoundary>
      {/* Invisible analytic sphere for picking (the real mesh is shader-displaced). */}
      <mesh onDoubleClick={onDoubleClick}>
        <sphereGeometry args={[1, 96, 48]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <SiteMarkers />
      <CameraRig exaggeration={exaggeration} />
    </Canvas>
  );
}

function LoadingSphere() {
  return (
    <mesh>
      <sphereGeometry args={[0.998, 64, 32]} />
      <meshStandardMaterial color="#3a3a3a" roughness={1} />
    </mesh>
  );
}
