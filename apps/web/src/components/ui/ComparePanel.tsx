"use client";

import type { Site } from "@lunar/core";
import { useSiteAnalysis } from "@/lib/conditions";
import { fmtDeg, fmtIn, fmtLatLon, fmtPct, fmtWm2 } from "@/lib/format";
import { useApp } from "@/lib/store";
import { SkyView } from "../charts/SkyView";
import { WindowTimeline } from "../charts/WindowTimeline";

/** Side-by-side comparison of up to 3 pinned sites, same clock and window. */
export function ComparePanel({ onClose }: { onClose: () => void }) {
  const sites = useApp((s) => s.sites);
  const compareIds = useApp((s) => s.compareIds);
  const pinned = compareIds
    .map((id) => sites.find((s) => s.id === id))
    .filter(Boolean) as Site[];

  return (
    <div className="pointer-events-auto flex max-h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/85 backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold">
          Compare sites · same date, same 30-day window
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-white/15 px-2 py-1 text-xs hover:bg-white/10"
        >
          Close
        </button>
      </div>
      {pinned.length === 0 ? (
        <p className="p-4 text-sm text-neutral-400">
          Use “+ Compare” on a site to pin it here (up to 3).
        </p>
      ) : (
        <div
          className="grid gap-3 overflow-y-auto p-3"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          {pinned.map((s) => (
            <CompareColumn key={s.id} site={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function CompareColumn({ site }: { site: Site }) {
  const a = useSiteAnalysis(site);
  const timeMs = useApp((s) => s.timeMs);
  const toggleCompare = useApp((s) => s.toggleCompare);
  const select = useApp((s) => s.select);
  if (!a) return <div className="text-sm text-neutral-500">Computing…</div>;
  const c = a.conditions;
  const rows: [string, string][] = [
    [
      "Sun now",
      `${fmtDeg(a.now.sun.elevationDeg)} · ${a.now.sun.visibleFraction >= 0.5 ? "lit" : "dark"}`,
    ],
    [
      a.nextSun?.kind === "set" ? "Sunset in" : "Sunrise in",
      a.nextSun ? fmtIn(a.nextSun.timeMs - timeMs) : "none in 30 d",
    ],
    [
      "Earth now",
      `${fmtDeg(a.now.earth.elevationDeg)} · ${a.now.earth.visibleFraction >= 0.5 ? "in view" : "hidden"}`,
    ],
    [
      a.nextEarth?.kind === "set" ? "Earthset in" : "Earthrise in",
      a.nextEarth ? fmtIn(a.nextEarth.timeMs - timeMs) : "none in 30 d",
    ],
    ["Sunlit (30 d)", fmtPct(c.sunlitFraction)],
    ["Earth in view", fmtPct(c.earthVisibleFraction)],
    ["Longest night", fmtIn(a.longestNightMs)],
    ["Max Sun elev.", fmtDeg(c.maxSunElevationDeg)],
    ["Solar, vertical panel", `${fmtWm2(a.energy.verticalMeanWm2)} avg`],
  ];
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-white/[0.02] p-2">
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => select(site.id)}
          className="min-w-0 text-left"
        >
          <div className="truncate text-sm font-medium text-neutral-50 hover:underline">
            {site.name}
          </div>
          <div className="font-mono text-[10px] text-neutral-500">
            {fmtLatLon(site.lat, site.lon)}
          </div>
        </button>
        <button
          type="button"
          onClick={() => toggleCompare(site.id)}
          className="text-xs text-neutral-500 hover:text-neutral-200"
          aria-label={`Remove ${site.name} from comparison`}
        >
          ✕
        </button>
      </div>
      <table className="mb-2 w-full text-xs">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-white/5">
              <td className="py-0.5 text-neutral-400">{k}</td>
              <td className="py-0.5 text-right font-mono text-neutral-100">
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SkyView a={a} height={130} compact />
      <WindowTimeline a={a} compact />
    </div>
  );
}
