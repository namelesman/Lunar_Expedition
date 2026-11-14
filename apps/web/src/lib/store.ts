"use client";

import type { Site } from "@lunar/core";
import { create } from "zustand";
import type { ModelQuality } from "./svsGlb";
import type { TerrainState } from "./terrainHorizon";

export const MAX_COMPARE = 3;
/** Length of the analysis window (one lunar synodic month ≈ 29.5 d). */
export const WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
/** Round down to the hour so the sample grid is stable while the clock runs. */
const floorHour = (t: number) => Math.floor(t / 3_600_000) * 3_600_000;

export type BodyScale = "real" | "enlarged";
export type SkyBody = "earth" | "sun";
/** Enlargement factor of the "not to scale" Sun/Earth mode. */
export const ENLARGED_BODY_SCALE = 4;

export interface AppState {
  sites: Site[];
  selectedId: string | null;
  /** Sites pinned for side-by-side comparison (max 3). */
  compareIds: string[];
  /** Simulation time, epoch ms (UTC). */
  timeMs: number;
  /** Start of the 30-day analysis window (epoch ms, UTC). */
  windowStartMs: number;
  playing: boolean;
  /** Simulated hours per real second while playing. */
  playRateHps: number;
  exaggeration: number;
  quality: ModelQuality;
  /** "sun": real Sun direction for the selected time; "flat": even light for exploring. */
  lighting: "sun" | "flat";
  /** Incremented to ask the camera to fly to `selectedId`. */
  flyRequest: number;
  /** Apparent size of the Sun and Earth in the sky: true, or 4× (not to scale). */
  bodyScale: BodyScale;
  /** Camera preset that frames the Sun or the Earth just past the lunar limb. */
  viewRequest: { body: SkyBody; n: number } | null;
  /** Terrain horizons computed in the browser for custom points, by site id. */
  terrain: Record<string, TerrainState>;

  setSites: (sites: Site[]) => void;
  addCustomSite: (site: Site) => void;
  select: (id: string | null, fly?: boolean) => void;
  toggleCompare: (id: string) => void;
  /** Move the clock; shifts the analysis window if the time leaves it. */
  setTimeMs: (t: number) => void;
  /** Jump to a date: re-centres the analysis window (1 day before → 29 days after). */
  jumpTo: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setPlayRate: (hps: number) => void;
  setExaggeration: (k: number) => void;
  setQuality: (q: ModelQuality) => void;
  setLighting: (l: "sun" | "flat") => void;
  setBodyScale: (b: BodyScale) => void;
  flyToBody: (body: SkyBody) => void;
  setTerrain: (siteId: string, state: TerrainState) => void;
  /** Forget a failed terrain horizon so it is computed again. */
  retryTerrain: (siteId: string) => void;
}

export const useApp = create<AppState>((set) => ({
  sites: [],
  selectedId: null,
  compareIds: [],
  timeMs: Date.now(),
  windowStartMs: floorHour(Date.now() - DAY_MS),
  playing: false,
  playRateHps: 12,
  exaggeration: 1,
  quality: "high",
  lighting: "sun",
  flyRequest: 0,
  bodyScale: "real",
  viewRequest: null,
  terrain: {},

  setSites: (sites) => set({ sites }),
  addCustomSite: (site) =>
    set((s) => ({
      sites: [...s.sites.filter((x) => x.id !== site.id), site],
      selectedId: site.id,
      flyRequest: s.flyRequest + 1,
    })),
  select: (id, fly = true) =>
    set((s) => ({
      selectedId: id,
      flyRequest: fly && id ? s.flyRequest + 1 : s.flyRequest,
    })),
  toggleCompare: (id) =>
    set((s) => {
      if (s.compareIds.includes(id))
        return { compareIds: s.compareIds.filter((x) => x !== id) };
      const next = [...s.compareIds, id];
      return { compareIds: next.slice(-MAX_COMPARE) };
    }),
  setTimeMs: (timeMs) =>
    set((s) => {
      const end = s.windowStartMs + WINDOW_DAYS * DAY_MS;
      if (timeMs >= s.windowStartMs && timeMs <= end) return { timeMs };
      return { timeMs, windowStartMs: floorHour(timeMs - DAY_MS) };
    }),
  jumpTo: (timeMs) =>
    set({ timeMs, windowStartMs: floorHour(timeMs - DAY_MS) }),
  setPlaying: (playing) => set({ playing }),
  setPlayRate: (playRateHps) => set({ playRateHps }),
  setExaggeration: (exaggeration) => set({ exaggeration }),
  setQuality: (quality) => set({ quality }),
  setLighting: (lighting) => set({ lighting }),
  setBodyScale: (bodyScale) => set({ bodyScale }),
  flyToBody: (body) =>
    set((s) => ({ viewRequest: { body, n: (s.viewRequest?.n ?? 0) + 1 } })),
  setTerrain: (siteId, state) =>
    set((s) => ({ terrain: { ...s.terrain, [siteId]: state } })),
  retryTerrain: (siteId) =>
    set((s) => {
      const terrain = { ...s.terrain };
      delete terrain[siteId];
      return { terrain };
    }),
}));
