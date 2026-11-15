"use client";

import type { Site } from "@lunar/core";
import { useApp } from "@/lib/store";
import { siteColor } from "../globe/SiteMarkers";

const GROUPS: { key: Site["category"]; label: string }[] = [
  { key: "south-pole-feature", label: "South pole" },
  { key: "clps", label: "CLPS (NASA commercial)" },
  { key: "international", label: "Other agencies" },
  { key: "apollo", label: "Apollo" },
  { key: "artemis", label: "Artemis" },
  { key: "custom", label: "Your points" },
];

export function SiteList({ onPick }: { onPick?: () => void } = {}) {
  const sites = useApp((s) => s.sites);
  const selectedId = useApp((s) => s.selectedId);
  const compareIds = useApp((s) => s.compareIds);
  const select = useApp((s) => s.select);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden">
      <h2 className="border-b border-white/10 px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-400">
        Landing sites
      </h2>
      <div className="min-h-0 overflow-y-auto text-sm">
        {sites.length === 0 && (
          <p className="px-3 py-2 text-neutral-500">No sites loaded.</p>
        )}
        {GROUPS.map((g) => {
          const list = sites.filter((s) => s.category === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key}>
              <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-neutral-500">
                {g.label}
              </div>
              <ul>
                {list.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => {
                        select(s.id);
                        onPick?.();
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/5 ${
                        s.id === selectedId ? "bg-white/10" : ""
                      }`}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: siteColor(s) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {s.mission === "South pole reference"
                          ? s.name
                          : `${s.mission}`}
                      </span>
                      {compareIds.includes(s.id) && (
                        <span className="text-[10px] text-sky-300">pinned</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
