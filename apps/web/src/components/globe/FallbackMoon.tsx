"use client";

import { useTexture } from "@react-three/drei";
import { Component, type ReactNode } from "react";
import * as THREE from "three";

/**
 * Last-resort Moon: smooth sphere with the 2k LROC preview (CGI Moon Kit,
 * svs.gsfc.nasa.gov/4720). Used while the GLB is unavailable.
 * Equirectangular map centred on lon 0; three's SphereGeometry puts u = 0.5 at
 * -Z, so we rotate by -90° to bring lon 0 to +Z (our frame).
 */
export function FallbackMoon() {
  const map = useTexture("/textures/lroc_color_2k.jpg", (t) => {
    (Array.isArray(t) ? t : [t]).forEach(
      (tex) => (tex.colorSpace = THREE.SRGBColorSpace),
    );
  });
  return (
    <mesh rotation-y={-Math.PI / 2}>
      <sphereGeometry args={[1, 128, 64]} />
      <meshStandardMaterial map={map} roughness={1} metalness={0} />
    </mesh>
  );
}

export class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[scene] asset failed to load, using the fallback", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
