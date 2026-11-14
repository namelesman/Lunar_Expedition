"use client";

import type { Site } from "@lunar/core";
import { normalizeLon } from "@lunar/core";
import { useState } from "react";
import { useApp } from "@/lib/store";

export function makeCustomSite(lat: number, lon: number): Site {
  const la = Math.max(-90, Math.min(90, lat));
  const lo = normalizeLon(lon);
  return {
    id: `custom-${la.toFixed(4)}-${lo.toFixed(4)}`,
    name: `Custom ${la.toFixed(2)}°, ${lo.toFixed(2)}°`,
    mission: "Custom point",
    category: "custom",
    status: "custom",
    lat: la,
    lon: lo,
    description:
      "User-defined point. Sun and Earth geometry is exact; the horizon is a smooth sphere because no terrain mask was precomputed for this point.",
    source: "https://svs.gsfc.nasa.gov/4720",
  };
}

/** Enter any lunar coordinates (planetocentric, east-positive), or double-click the globe. */
export function CustomSiteForm() {
  const addCustomSite = useApp((s) => s.addCustomSite);
  const [lat, setLat] = useState("-89.45");
  const [lon, setLon] = useState("-137.31");
  const la = Number(lat);
  const lo = Number(lon);
  const valid =
    Number.isFinite(la) &&
    Number.isFinite(lo) &&
    Math.abs(la) <= 90 &&
    Math.abs(lo) <= 360;

  return (
    <form
      className="flex flex-col gap-1.5 border-t border-white/10 p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) addCustomSite(makeCustomSite(la, lo));
      }}
    >
      <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
        Custom coordinates
      </span>
      <div className="flex gap-1.5">
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-neutral-500">Lat (°N)</span>
          <input
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            inputMode="decimal"
            className="w-full rounded border border-white/10 bg-neutral-900 px-1.5 py-1 font-mono"
          />
        </label>
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-neutral-500">Lon (°E)</span>
          <input
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            inputMode="decimal"
            className="w-full rounded border border-white/10 bg-neutral-900 px-1.5 py-1 font-mono"
          />
        </label>
        <button
          type="submit"
          disabled={!valid}
          className="self-end rounded border border-white/15 px-2 py-1 hover:bg-white/10 disabled:opacity-40"
        >
          Go
        </button>
      </div>
      <span className="text-[10px] text-neutral-500">
        Tip: double-click the Moon to drop a point.
      </span>
    </form>
  );
}
