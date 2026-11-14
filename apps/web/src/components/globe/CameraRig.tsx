"use client";

import { enuBasis, latLonToVector3 } from "@lunar/core";
import { TrackballControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { TrackballControls as TrackballImpl } from "three-stdlib";
import { useApp } from "@/lib/store";

const FLY_SECONDS = 1.8;
/** Distance from the Moon centre (in radii) the camera flies to for a site. */
const FLY_DISTANCE = 1.45;

interface Flight {
  t: number;
  fromDir: THREE.Vector3;
  toDir: THREE.Vector3;
  fromDist: number;
  toDist: number;
  fromUp: THREE.Vector3;
  toUp: THREE.Vector3;
}

const v = (p: { x: number; y: number; z: number }) =>
  new THREE.Vector3(p.x, p.y, p.z);

/**
 * Free 360° camera: TrackballControls (no polar lock — the camera can pass over
 * both poles and look at the Moon from below), with rotate/zoom speeds scaled
 * by altitude so the same gesture works from orbit down to ~1 km.
 */
export function CameraRig({ exaggeration }: { exaggeration: number }) {
  const controls = useRef<TrackballImpl>(null);
  const flight = useRef<Flight | null>(null);
  const get = useThree((s) => s.get);
  const flyRequest = useApp((s) => s.flyRequest);

  useEffect(() => {
    if (!flyRequest) return;
    const { sites, selectedId } = useApp.getState();
    const site = sites.find((s) => s.id === selectedId);
    if (!site) return;
    const camera = get().camera;
    const toDir = v(latLonToVector3(site.lat, site.lon)).normalize();
    // Arrive looking "down" at the site with local north up on screen.
    const { north } = enuBasis(site.lat, site.lon);
    const fromDist = camera.position.length();
    flight.current = {
      t: 0,
      fromDir: camera.position.clone().normalize(),
      toDir,
      fromDist,
      toDist: Math.min(Math.max(fromDist, 1.15), FLY_DISTANCE),
      fromUp: camera.up.clone(),
      toUp: v(north),
    };
  }, [flyRequest, get]);

  useFrame((state, dt) => {
    const camera = state.camera as THREE.PerspectiveCamera;
    const c = controls.current;
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLY_SECONDS);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2; // easeInOutCubic
      const q = new THREE.Quaternion().setFromUnitVectors(f.fromDir, f.toDir);
      const dir = f.fromDir
        .clone()
        .applyQuaternion(new THREE.Quaternion().slerp(q, e));
      // Rise a bit mid-flight for long hops so the arc stays outside the Moon.
      const hop = f.fromDir.angleTo(f.toDir) / Math.PI;
      const dist =
        THREE.MathUtils.lerp(f.fromDist, f.toDist, e) +
        hop * 0.8 * Math.sin(Math.PI * e);
      camera.position.copy(dir.multiplyScalar(dist));
      camera.up.copy(f.fromUp.clone().lerp(f.toUp, e).normalize());
      camera.lookAt(0, 0, 0);
      if (c) c.enabled = false;
      if (f.t >= 1) {
        flight.current = null;
        if (c) c.enabled = true;
      }
    }

    const dist = camera.position.length();
    const alt = Math.max(dist - 1, 1e-5);
    if (c) {
      c.rotateSpeed = 2.2 * THREE.MathUtils.clamp(alt / 1.5, 0.0004, 1);
      c.zoomSpeed = 1.4 * THREE.MathUtils.clamp(alt / dist, 0.002, 1);
      c.minDistance = 1 + Math.max(0.0008, (exaggeration * 11) / 1737.4);
    }
    // Keep depth precision usable from orbit down to the surface.
    const near = THREE.MathUtils.clamp(alt * 0.25, 2e-6, 0.5);
    const far = dist + 60;
    if (Math.abs(camera.near - near) / near > 0.05 || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  });

  return (
    <TrackballControls
      ref={controls}
      noPan
      staticMoving={false}
      dynamicDampingFactor={0.15}
      minDistance={1.001}
      maxDistance={12}
    />
  );
}
