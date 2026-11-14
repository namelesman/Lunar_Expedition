"use client";

/**
 * Background sky seen from the Moon: the real star field, the Sun and the
 * Earth, at their true directions for the selected time.
 *
 * - Stars: NASA SVS Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851), re-encoded by
 *   scripts/src/make-sky-textures.ts with u = RA/360°, top row = Dec +90°.
 *   Oriented with eqjToSceneBasis (J2000 → Moon-fixed scene frame), so the sky
 *   turns over the Moon once per sidereal month, as it really does.
 * - Sun: true apparent radius (~0.27°) plus two additive glow sprites. No
 *   atmosphere on the Moon, so the glare is camera-like and fades as the limb
 *   covers the disk.
 * - Earth: true direction and apparent radius (~0.95°) from the camera, phase
 *   lit by the real Sun, NASA Blue Marble texture turned with Greenwich
 *   sidereal time (earthFixedBasis), thin atmosphere rim on the day side.
 *
 * Everything is drawn just beyond the far side of the Moon from the camera
 * (distance = |camera| + a few radii) so the Moon always occludes it and depth
 * precision stays usable when the camera is close to the surface.
 */
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  earthFixedBasis,
  eqjToSceneBasis,
  moonSkyState,
  type Basis3,
  type MoonSkyState,
} from "@lunar/core";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { assetUrl } from "@/lib/assets";
import { ENLARGED_BODY_SCALE, useApp } from "@/lib/store";

export const STAR_MAP_PATH = "sky/starmap-4k.jpg";
export const EARTH_TEXTURE_PATH = "/textures/earth-bmng-2k.jpg";

/** Extra distance (scene units, Moon radii) beyond the camera–Moon-centre distance. */
const EARTH_BEYOND = 2;
const SUN_BEYOND = 4;
const STARS_BEYOND = 8;

// ---------------------------------------------------------------------------
// Shared, time-dependent sky geometry (recomputed only when the clock moves)
// ---------------------------------------------------------------------------

interface SkyNow {
  timeMs: number;
  sky: MoonSkyState;
  eqj: Basis3;
  earth: Basis3;
}

let cache: SkyNow | null = null;
function skyNow(timeMs: number): SkyNow {
  if (cache && cache.timeMs === timeMs) return cache;
  cache = {
    timeMs,
    sky: moonSkyState(timeMs),
    eqj: eqjToSceneBasis(timeMs),
    earth: earthFixedBasis(timeMs),
  };
  return cache;
}

/** Matrix taking scene vectors into the frame whose axes are `b` (rows = basis vectors). */
function toFrame(m: THREE.Matrix3, [x, y, z]: Basis3): THREE.Matrix3 {
  return m.set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
}

// Scratch vectors (module-level: per-frame code must not allocate or mutate hook values).
const SUN = new THREE.Vector3();
const TO_MOON = new THREE.Vector3();
const EARTH = new THREE.Vector3();

function bodyScaleFactor(): number {
  return useApp.getState().bodyScale === "enlarged" ? ENLARGED_BODY_SCALE : 1;
}

// GLSL: pick between two longitude parameterisations so the texture seam does
// not produce a one-pixel line through mip-level selection (Tarini 2012).
const SEAMLESS_U = /* glsl */ `
float seamlessU(float a) {
  float u1 = fract(a);
  float u2 = fract(a + 0.5) - 0.5;
  return fwidth(u1) <= fwidth(u2) + 1e-5 ? u1 : u2;
}`;

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

export function StarSphere() {
  const map = useTexture(assetUrl(STAR_MAP_PATH), (t) => {
    for (const tex of Array.isArray(t) ? t : [t]) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      // Always magnified (fixed 45° field of view), so no mipmaps are needed.
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 1;
    }
  });
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null as THREE.Texture | null },
          sceneToEqj: { value: new THREE.Matrix3() },
          beyond: { value: STARS_BEYOND },
          intensity: { value: 1.0 },
        },
        vertexShader: /* glsl */ `
          uniform float beyond;
          varying vec3 vDir;
          void main() {
            vDir = position;
            // Sphere centred on the camera, just inside the far plane: stars at infinity.
            vec3 world = cameraPosition + normalize(position) * (length(cameraPosition) + beyond);
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          #define PI 3.141592653589793
          uniform sampler2D map;
          uniform mat3 sceneToEqj;
          uniform float intensity;
          varying vec3 vDir;
          ${SEAMLESS_U}
          void main() {
            vec3 d = normalize(sceneToEqj * normalize(vDir));
            float u = seamlessU(atan(d.y, d.x) / (2.0 * PI));
            float v = 0.5 + asin(clamp(d.z, -1.0, 1.0)) / PI;
            gl_FragColor = vec4(texture2D(map, vec2(u, v)).rgb * intensity, 1.0);
            #include <colorspace_fragment>
          }`,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const mat = m.material as THREE.ShaderMaterial;
    mat.uniforms.map.value = map;
    const { eqj } = skyNow(useApp.getState().timeMs);
    toFrame(mat.uniforms.sceneToEqj.value as THREE.Matrix3, eqj);
  });

  return (
    <mesh ref={mesh} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// Sun
// ---------------------------------------------------------------------------

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fraction of a disk (angular radius r) left visible by a disk (radius R) whose centres are `sep` apart. */
function uncoveredFraction(sep: number, r: number, R: number): number {
  if (sep >= R + r) return 1;
  if (sep <= R - r) return 0;
  return (sep - (R - r)) / (2 * r);
}

export function SunGlow() {
  const textures = useMemo(
    () => ({
      disk: radialTexture([
        [0, "rgba(255,255,255,1)"],
        [0.82, "rgba(255,253,245,1)"],
        [1, "rgba(255,250,235,0)"],
      ]),
      glow: radialTexture([
        [0, "rgba(255,244,220,0.9)"],
        [0.12, "rgba(255,226,170,0.45)"],
        [0.4, "rgba(255,200,130,0.10)"],
        [1, "rgba(255,190,120,0)"],
      ]),
      halo: radialTexture([
        [0, "rgba(255,236,200,0.35)"],
        [0.3, "rgba(255,220,170,0.08)"],
        [1, "rgba(255,210,160,0)"],
      ]),
    }),
    [],
  );
  const disk = useRef<THREE.Sprite>(null);
  const glow = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);

  useFrame(({ camera }) => {
    const { sky } = skyNow(useApp.getState().timeMs);
    const scale = bodyScaleFactor();
    const dist = camera.position.length();
    const L = dist + SUN_BEYOND;
    const ang = Math.asin(SUN_RADIUS_KM / sky.sunDistanceKm);
    SUN.set(sky.sunDir.x, sky.sunDir.y, sky.sunDir.z);
    // Glare fades as the Moon's limb covers the disk (Moon treated as a sphere).
    TO_MOON.copy(camera.position).negate().normalize();
    const sep = TO_MOON.angleTo(SUN);
    const visible = uncoveredFraction(
      sep,
      ang * scale,
      Math.asin(Math.min(1, 1 / dist)),
    );
    const place = (
      s: THREE.Sprite | null,
      angularRadius: number,
      opacity: number,
    ) => {
      if (!s) return;
      s.position.copy(camera.position).addScaledVector(SUN, L);
      const size = 2 * L * Math.tan(angularRadius);
      s.scale.set(size, size, 1);
      (s.material as THREE.SpriteMaterial).opacity = opacity;
    };
    place(disk.current, ang * scale * 1.06, 1);
    place(
      glow.current,
      THREE.MathUtils.degToRad(2.2) * Math.sqrt(scale),
      0.85 * visible,
    );
    place(halo.current, THREE.MathUtils.degToRad(14), 0.55 * visible);
  });

  const common = {
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  } as const;
  return (
    <group>
      <sprite ref={halo} frustumCulled={false} renderOrder={1}>
        <spriteMaterial map={textures.halo} {...common} />
      </sprite>
      <sprite ref={glow} frustumCulled={false} renderOrder={2}>
        <spriteMaterial map={textures.glow} {...common} />
      </sprite>
      <sprite ref={disk} frustumCulled={false} renderOrder={3}>
        <spriteMaterial map={textures.disk} color="#fffaf0" {...common} />
      </sprite>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Earth
// ---------------------------------------------------------------------------

export function EarthBody() {
  const map = useTexture(EARTH_TEXTURE_PATH, (t) => {
    for (const tex of Array.isArray(t) ? t : [t]) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = 4;
    }
  });
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: null as THREE.Texture | null },
          sceneToEarth: { value: new THREE.Matrix3() },
          sunDir: { value: new THREE.Vector3(1, 0, 0) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vNormalW;
          varying vec3 vViewW;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vNormalW = normalize(mat3(modelMatrix) * normal);
            vViewW = normalize(cameraPosition - world.xyz);
            gl_Position = projectionMatrix * viewMatrix * world;
          }`,
        fragmentShader: /* glsl */ `
          #define PI 3.141592653589793
          uniform sampler2D map;
          uniform mat3 sceneToEarth;
          uniform vec3 sunDir;
          varying vec3 vNormalW;
          varying vec3 vViewW;
          ${SEAMLESS_U}
          void main() {
            vec3 n = normalize(vNormalW);
            vec3 e = sceneToEarth * n; // x → lon 0°, y → lon 90°E, z → north pole
            float u = seamlessU(atan(e.y, e.x) / (2.0 * PI) + 0.5);
            float v = 0.5 + asin(clamp(e.z, -1.0, 1.0)) / PI;
            vec3 albedo = texture2D(map, vec2(u, v)).rgb;
            float ndl = dot(n, sunDir);
            // Soft terminator (Earth's atmosphere scatters a little past it).
            float day = smoothstep(-0.08, 0.18, ndl);
            vec3 color = albedo * (0.10 + 1.15 * max(ndl, 0.0)) * day + albedo * 0.012;
            // Thin blue rim on the day side.
            float rim = pow(1.0 - max(dot(n, normalize(vViewW)), 0.0), 2.5);
            color += vec3(0.32, 0.56, 1.0) * rim * smoothstep(-0.25, 0.35, ndl) * 0.85;
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }`,
        toneMapped: false,
      }),
    [],
  );
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    const { sky, earth } = skyNow(useApp.getState().timeMs);
    const mat = m.material as THREE.ShaderMaterial;
    mat.uniforms.map.value = map;
    toFrame(mat.uniforms.sceneToEarth.value as THREE.Matrix3, earth);
    (mat.uniforms.sunDir.value as THREE.Vector3).set(
      sky.sunDir.x,
      sky.sunDir.y,
      sky.sunDir.z,
    );
    // Exact apparent direction and size from the camera (scene units = Moon radii).
    const k = sky.earthDistanceKm / MOON_RADIUS_KM;
    EARTH.set(sky.earthDir.x * k, sky.earthDir.y * k, sky.earthDir.z * k).sub(
      camera.position,
    );
    const dKm = EARTH.length() * MOON_RADIUS_KM;
    EARTH.normalize();
    const L = camera.position.length() + EARTH_BEYOND;
    const ang = Math.asin(EARTH_RADIUS_KM / dKm) * bodyScaleFactor();
    m.position.copy(camera.position).addScaledVector(EARTH, L);
    m.scale.setScalar(L * Math.sin(ang));
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false}>
      <sphereGeometry args={[1, 64, 32]} />
    </mesh>
  );
}
