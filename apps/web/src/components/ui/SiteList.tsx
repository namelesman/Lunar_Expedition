"use client";

import { useApp } from "@/lib/store";
import { siteColor } from "../globe/SiteMarkers";

export function SiteList() {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);

  return (
    <div className="flex max-h-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black/60 backdrop-blur">
      <h2 className="border-b border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-400">
        Landing sites
      </h2>
      <ul className="overflow-y-auto text-sm">
        {sites.length === 0 && <li className="px-3 py-2 text-neutral-500">No sites loaded.</li>}
        {sites.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => select(s.id)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/5 ${
                s.id === selectedId ? "bg-white/10" : ""
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: siteColor(s) }} />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">
                {s.lat.toFixed(2)}°, {s.lon.toFixed(2)}°
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
