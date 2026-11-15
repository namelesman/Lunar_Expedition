"use client";

import { ENLARGED_BODY_SCALE, useApp } from "@/lib/store";
import { MOON_MODELS, type ModelQuality } from "@/lib/svsGlb";

export function ViewControls() {
  const exaggeration = useApp((s) => s.exaggeration);
  const setExaggeration = useApp((s) => s.setExaggeration);
  const quality = useApp((s) => s.quality);
  const setQuality = useApp((s) => s.setQuality);
  const lighting = useApp((s) => s.lighting);
  const setLighting = useApp((s) => s.setLighting);
  const bodyScale = useApp((s) => s.bodyScale);
  const setBodyScale = useApp((s) => s.setBodyScale);
  const flyToBody = useApp((s) => s.flyToBody);

  return (
    <div className="pointer-events-auto flex flex-col gap-2 rounded-lg border border-white/10 bg-black/60 p-3 text-xs backdrop-blur">
      <label className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 text-neutral-300">Vertical exaggeration</span>
        <input
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={exaggeration}
          onChange={(e) => setExaggeration(Number(e.target.value))}
          className="w-28 accent-sky-400"
          aria-label="Vertical exaggeration"
        />
        <span
          className="w-14 text-right font-mono text-sm text-neutral-100"
          aria-live="polite"
        >
          {exaggeration.toFixed(1)}×
        </span>
      </label>
      <p className="text-[10px] text-neutral-500">1× = real LOLA relief</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 text-neutral-300">Lighting</span>
        <div className="flex overflow-hidden rounded border border-white/10">
          {(["sun", "flat"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLighting(l)}
              className={`px-2 py-0.5 ${lighting === l ? "bg-white/15 text-neutral-100" : "text-neutral-400 hover:bg-white/5"}`}
            >
              {l === "sun" ? "Real Sun (selected time)" : "Even"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 text-neutral-300">Sun &amp; Earth size</span>
        <div className="flex overflow-hidden rounded border border-white/10">
          {(["real", "enlarged"] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBodyScale(b)}
              aria-pressed={bodyScale === b}
              className={`px-2 py-0.5 ${bodyScale === b ? "bg-white/15 text-neutral-100" : "text-neutral-400 hover:bg-white/5"}`}
            >
              {b === "real" ? "Real" : `${ENLARGED_BODY_SCALE}× (not to scale)`}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 text-neutral-300">Look toward</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => flyToBody("earth")}
            className="rounded border border-white/10 px-2 py-0.5 text-neutral-300 hover:bg-white/10"
          >
            Earth
          </button>
          <button
            type="button"
            onClick={() => flyToBody("sun")}
            className="rounded border border-white/10 px-2 py-0.5 text-neutral-300 hover:bg-white/10"
          >
            Sun
          </button>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-28 text-neutral-300">Model quality</span>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as ModelQuality)}
          className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5"
        >
          {(Object.keys(MOON_MODELS) as ModelQuality[]).map((q) => (
            <option key={q} value={q}>
              {q === "high" ? "High" : "Lite"} — {MOON_MODELS[q].label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
