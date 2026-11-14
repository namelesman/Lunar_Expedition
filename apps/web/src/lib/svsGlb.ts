/**
 * Calibration of the NASA SVS model "Moon_NASA_LRO_8k_Topo.glb" (svs.gsfc.nasa.gov/14959)
 * against LOLA (CGI Moon Kit ldem_16, svs.gsfc.nasa.gov/4720).
 *
 * scripts/src/fit-glb-scale.ts fits, on 39 936 random vertices (|lat| < 88°, LOLA sampled bilinearly):
 *   r_glb = C0 + C2·sin²(lat) + C4·sin⁴(lat) + UNITS_PER_KM · h_km
 * with corr = 0.976 (relief vs LOLA) and rms ≈ 0.50 km. The base shape is slightly prolate (an
 * artifact of the model) and the relief is exaggerated ≈1.70×. The vertex
 * shader in MoonModel.tsx uses these numbers to rebuild the surface on a unit
 * sphere with a TRUE, user-controlled exaggeration (1× = real).
 */
export const SVS_GLB_FIT = {
  c0: 0.961455824,
  c2: 0.004998904,
  c4: 0.002347373,
  unitsPerKm: 0.000942207,
  /** Exaggeration baked into the original model: unitsPerKm · 1737.4 / c0. */
  bakedExaggeration: 1.7026,
} as const;

export const MOON_MODELS = {
  high: { file: "models/moon-8k.glb", label: "8k texture · 508k triangles" },
  lite: { file: "models/moon-lite.glb", label: "4k texture · 122k triangles" },
} as const;

export type ModelQuality = keyof typeof MOON_MODELS;
