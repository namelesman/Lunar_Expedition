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
import { MarkerLayer, MarkerProjector } from "./SiteMarkers";
import { EarthBody, StarSphere, SunGlow } from "./SkyLayer";

const START = latLonToVector3(-30, 10, 3.4);

export interface MoonSceneProps {
  /** Unit vector toward the Sun in the Moon-fixed frame. */
  sunDirection: Vec3;
  /** Unit vector toward the Earth in the Moon-fixed frame (earthshine). */
  earthDirection: Vec3;
  /** Illuminated fraction of the Earth seen from the Moon (drives earthshine). */
  earthIllumination?: number;
  /** Called with the lat/lon of a double-clicked surface point. */
  onPickSurface?: (lat: number, lon: number) => void;
  /** Reports GPU limits so the app can pick the model quality. */
  onCapabilities?: (maxTextureSize: number) => void;
}

export default function MoonScene({
  sunDirection,
  earthDirection,
  earthIllumination = 0.5,
  onPickSurface,
  onCapabilities,
}: MoonSceneProps) {
  const exaggeration = useApp((s) => s.exaggeration);
  const quality = useApp((s) => s.quality);
  const lighting = useApp((s) => s.lighting);
  const sun = useMemo(
    () =>
      new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z)
        .normalize()
        .multiplyScalar(20),
    [sunDirection.x, sunDirection.y, sunDirection.z],
  );

  const earth = useMemo(
    () =>
      new THREE.Vector3(earthDirection.x, earthDirection.y, earthDirection.z)
        .normalize()
        .multiplyScalar(20),
    [earthDirection.x, earthDirection.y, earthDirection.z],
  );

  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const { lat, lon } = vector3ToLatLon(e.point);
    onPickSurface?.(lat, lon);
  };

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{
          position: [START.x, START.y, START.z],
          fov: 45,
          near: 0.01,
          far: 100,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true, logarithmicDepthBuffer: false }}
        onCreated={({ gl }) => onCapabilities?.(gl.capabilities.maxTextureSize)}
      >
        <color attach="background" args={["#000000"]} />
        {/* Real sky (NASA star map); procedural stars if the texture is unavailable. */}
        <ModelErrorBoundary
          fallback={
            <Stars
              radius={40}
              depth={20}
              count={5000}
              factor={2.2}
              saturation={0}
              fade
              speed={0}
            />
          }
        >
          <Suspense fallback={null}>
            <StarSphere />
          </Suspense>
        </ModelErrorBoundary>
        {/* Earthshine comes from the Earth: it lights the near side only, more near "full Earth". */}
        <ambientLight intensity={lighting === "flat" ? 2.2 : 0.035} />
        {lighting === "sun" && (
          <directionalLight
            position={earth}
            intensity={0.08 + 0.55 * earthIllumination}
            color="#c9dcff"
          />
        )}
        {lighting === "sun" && (
          <directionalLight position={sun} intensity={3.2} />
        )}
        <ModelErrorBoundary
          fallback={
            <Suspense fallback={<LoadingSphere />}>
              <FallbackMoon />
            </Suspense>
          }
        >
          <Suspense fallback={<LoadingSphere />}>
            <MoonModel
              url={assetUrl(MOON_MODELS[quality].file)}
              exaggeration={exaggeration}
              patchStride={quality === "high" ? 1 : 2}
            />
          </Suspense>
        </ModelErrorBoundary>
        {/* Invisible analytic sphere for picking (the real mesh is shader-displaced). */}
        <mesh onDoubleClick={onDoubleClick}>
          <sphereGeometry args={[1, 96, 48]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            colorWrite={false}
          />
        </mesh>
        <MarkerProjector />
        <CameraRig exaggeration={exaggeration} />
        {/* After CameraRig so the bodies follow the camera of the current frame. */}
        <SunGlow />
        <ModelErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <EarthBody />
          </Suspense>
        </ModelErrorBoundary>
      </Canvas>
      <MarkerLayer />
    </div>
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
