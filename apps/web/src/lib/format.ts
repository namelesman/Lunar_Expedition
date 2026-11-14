import { formatDuration } from "@lunar/core";

export const COLORS = {
  // Validated with the dataviz palette checker on #0d0d0f (dark): lightness band,
  // CVD separation (worst ΔE 19.8) and 3:1 contrast all pass.
  sun: "#c08515",
  earth: "#3b8fe8",
  both: "#1f9e68",
  terrain: "#3f3f46",
  terrainEdge: "#a1a1aa",
  grid: "#27272a",
  surface: "#0d0d0f",
} as const;

export function fmtDeg(v: number, digits = 1): string {
  return `${v.toFixed(digits)}°`;
}

export function fmtLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(3)}°${ns} ${Math.abs(lon).toFixed(3)}°${ew}`;
}

export function fmtUtc(t: number, withTime = true): string {
  const iso = new Date(t).toISOString();
  return withTime
    ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
    : iso.slice(0, 10);
}

export function fmtPct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

export function fmtIn(ms: number): string {
  return formatDuration(ms);
}
