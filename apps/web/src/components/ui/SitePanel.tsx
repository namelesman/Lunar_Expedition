"use client";

import { useSiteAnalysis } from "@/lib/conditions";
import { fmtLatLon } from "@/lib/format";
import { MAX_COMPARE, useApp } from "@/lib/store";
import type { TerrainState } from "@/lib/terrainHorizon";
import { SkyView } from "../charts/SkyView";
import { WindowTimeline } from "../charts/WindowTimeline";
import { Metrics, NowCards } from "./NowCards";

export function SitePanel() {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const compareIds = useApp((s) => s.compareIds);
  const toggleCompare = useApp((s) => s.toggleCompare);
  const select = useApp((s) => s.select);
  const timeMs = useApp((s) => s.timeMs);
  const site = sites.find((s) => s.id === selectedId);
  const a = useSiteAnalysis(site);
  const terrain = useApp((s) => (site ? s.terrain[site.id] : undefined));
  const retryTerrain = useApp((s) => s.retryTerrain);
  const browserHorizon = site?.category === "custom" && terrain?.status === "ready";

  if (!site) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/70 p-4 text-sm text-neutral-300 backdrop-blur">
        <h2 className="mb-1 font-medium text-neutral-100">
          Pick a landing site
        </h2>
        <p className="text-neutral-400">
          Choose a site from the list or click a marker on the Moon — or enter
          your own coordinates. You will see where the Sun and the Earth are
          relative to the real terrain horizon, how long until sunset or
          Earthset, and the power and communication windows for the next 30
          days.
        </p>
      </div>
    );
  }

  const inCompare = compareIds.includes(site.id);
  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/75 backdrop-blur">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-neutral-50">
            {site.name}
          </h2>
          <p className="text-xs text-neutral-400">
            {site.mission}
            {site.agency ? ` · ${site.agency}` : ""}
            {site.date ? ` · ${site.date}` : ""}
          </p>
          <p className="font-mono text-[11px] text-neutral-500">
            {fmtLatLon(site.lat, site.lon)}
            {a?.mask ? ` · ${Math.round(a.mask.siteElevationM)} m` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => toggleCompare(site.id)}
            className={`rounded border px-2 py-1 text-xs ${
              inCompare
                ? "border-sky-400/60 bg-sky-400/15 text-sky-200"
                : "border-white/15 hover:bg-white/10"
            }`}
            title={`Pin up to ${MAX_COMPARE} sites to compare side by side`}
          >
            {inCompare ? "✓ Comparing" : "+ Compare"}
          </button>
          <button
            type="button"
            onClick={() => select(null, false)}
            className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
            aria-label="Close site panel"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="space-y-3 overflow-y-auto p-3">
        {!a ? (
          <p className="text-sm text-neutral-500">Computing ephemeris…</p>
        ) : (
          <>
            <NowCards a={a} timeMs={timeMs} />
            <section>
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                Local sky (looking around 360°)
              </h3>
              <SkyView a={a} />
              {site.category === "custom" ? (
                <TerrainNotice
                  terrain={terrain}
                  onRetry={() => retryTerrain(site.id)}
                />
              ) : (
                !a.mask && (
                  <p className="mt-1 text-[10px] text-amber-300/80">
                    No terrain data for this point: horizon = smooth sphere.
                    Results may be optimistic near mountains and craters.
                  </p>
                )
              )}
            </section>
            <section>
              <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
                Next 30 days
              </h3>
              <WindowTimeline a={a} />
            </section>
            <Metrics a={a} />
            <p className="text-[11px] leading-relaxed text-neutral-400">
              {site.description}
            </p>
            <p className="text-[10px] text-neutral-500">
              Coordinates:{" "}
              <a
                href={site.source}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-neutral-300"
              >
                {new URL(site.source).hostname}
              </a>
              {site.coordinateNote ? ` — ${site.coordinateNote}` : ""}
              {a.mask
                ? ` Horizon: ${browserHorizon ? "Terrain horizon computed in your browser from LOLA (NASA): " : ""}${a.mask.demSource}, observer ${a.mask.observerHeightM} m above ground, up to ${a.mask.maxDistanceKm} km.`
                : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Status of the browser-computed terrain horizon of a custom point. */
function TerrainNotice({
  terrain,
  onRetry,
}: {
  terrain: TerrainState | undefined;
  onRetry: () => void;
}) {
  if (!terrain || terrain.status === "computing") {
    const t = terrain?.status === "computing" ? terrain : null;
    return (
      <p
        className="mt-1 text-[10px] text-sky-300/90"
        role="status"
        aria-live="polite"
      >
        Computing terrain horizon from LOLA…{" "}
        {t && t.total > 0
          ? `${t.done}/${t.total} tiles · ${(t.bytes / 1e6).toFixed(1)} MB`
          : "finding tiles"}
        . Until it is ready the horizon is a smooth sphere.
      </p>
    );
  }
  if (terrain.status === "failed") {
    return (
      <p className="mt-1 text-[10px] text-amber-300/80" role="status">
        Terrain data unavailable ({terrain.reason}): horizon = smooth sphere.
        Results may be optimistic near mountains and craters.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline hover:text-amber-200"
        >
          Retry
        </button>
      </p>
    );
  }
  const { stats } = terrain;
  return (
    <p className="mt-1 text-[10px] text-emerald-300/80" role="status">
      Terrain horizon computed in your browser from LOLA (NASA):{" "}
      {stats.fetched > 0
        ? `${(stats.bytes / 1e6).toFixed(1)} MB downloaded`
        : "terrain already in memory"}
      , {(terrain.ms / 1000).toFixed(1)} s.
    </p>
  );
}
