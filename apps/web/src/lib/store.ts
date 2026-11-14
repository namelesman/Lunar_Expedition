"use client";

import type { Site } from "@lunar/core";
import { create } from "zustand";
import type { ModelQuality } from "./svsGlb";

export const MAX_COMPARE = 3;

export interface AppState {
  sites: Site[];
  selectedId: string | null;
  /** Sites pinned for side-by-side comparison (max 3). */
  compareIds: string[];
  /** Simulation time, epoch ms (UTC). */
  timeMs: number;
  playing: boolean;
  /** Simulated hours per real second while playing. */
  playRateHps: number;
  exaggeration: number;
  quality: ModelQuality;
  /** Incremented to ask the camera to fly to `selectedId`. */
  flyRequest: number;

  setSites: (sites: Site[]) => void;
  addCustomSite: (site: Site) => void;
  select: (id: string | null, fly?: boolean) => void;
  toggleCompare: (id: string) => void;
  setTimeMs: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setPlayRate: (hps: number) => void;
  setExaggeration: (k: number) => void;
  setQuality: (q: ModelQuality) => void;
}

export const useApp = create<AppState>((set) => ({
  sites: [],
  selectedId: null,
  compareIds: [],
  timeMs: Date.now(),
  playing: false,
  playRateHps: 12,
  exaggeration: 1,
  quality: "high",
  flyRequest: 0,

  setSites: (sites) => set({ sites }),
  addCustomSite: (site) =>
    set((s) => ({
      sites: [...s.sites.filter((x) => x.id !== site.id), site],
      selectedId: site.id,
      flyRequest: s.flyRequest + 1,
    })),
  select: (id, fly = true) =>
    set((s) => ({ selectedId: id, flyRequest: fly && id ? s.flyRequest + 1 : s.flyRequest })),
  toggleCompare: (id) =>
    set((s) => {
      if (s.compareIds.includes(id)) return { compareIds: s.compareIds.filter((x) => x !== id) };
      const next = [...s.compareIds, id];
      return { compareIds: next.slice(-MAX_COMPARE) };
    }),
  setTimeMs: (timeMs) => set({ timeMs }),
  setPlaying: (playing) => set({ playing }),
  setPlayRate: (playRateHps) => set({ playRateHps }),
  setExaggeration: (exaggeration) => set({ exaggeration }),
  setQuality: (quality) => set({ quality }),
}));
