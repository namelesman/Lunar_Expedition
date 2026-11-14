"use client";

import { earthIlluminatedFraction, moonSkyState, type Site } from "@lunar/core";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { ComparePanel } from "./ui/ComparePanel";
import { Credits } from "./ui/Credits";
import { CustomSiteForm, makeCustomSite } from "./ui/CustomSiteForm";
import { SiteList } from "./ui/SiteList";
import { SitePanel } from "./ui/SitePanel";
import { TimeBar } from "./ui/TimeBar";
import { ViewControls } from "./ui/ViewControls";

const MoonScene = dynamic(() => import("./globe/MoonScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      Loading 3D Moon…
    </div>
  ),
});

export function App({ initialSites }: { initialSites: Site[] }) {
  const setSites = useApp((s) => s.setSites);
  const setQuality = useApp((s) => s.setQuality);
  const addCustomSite = useApp((s) => s.addCustomSite);
  const compareCount = useApp((s) => s.compareIds.length);
  const selectedId = useApp((s) => s.selectedId);
  // Light follows the real Sun; recompute at most once per simulated 10 min.
  const timeBucket = useApp((s) => Math.floor(s.timeMs / 600_000));
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => setSites(initialSites), [initialSites, setSites]);

  const sky = useMemo(() => moonSkyState(timeBucket * 600_000), [timeBucket]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black text-neutral-100">
      <div className="absolute inset-0">
        <MoonScene
          sunDirection={sky.sunDir}
          earthDirection={sky.earthDir}
          earthIllumination={earthIlluminatedFraction(sky)}
          onPickSurface={(lat, lon) => addCustomSite(makeCustomSite(lat, lon))}
          onCapabilities={(max) => {
            const mem = (navigator as Navigator & { deviceMemory?: number })
              .deviceMemory;
            if (max < 8192 || (mem !== undefined && mem < 4))
              setQuality("lite");
          }}
        />
      </div>

      <header className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between gap-4 p-3">
        <div className="pointer-events-auto">
          <h1 className="text-lg font-semibold tracking-tight">
            Lunar Landing Site Navigator
          </h1>
          <p className="text-xs text-neutral-400">
            Sun · Earth · real terrain horizon — compare sites and dates
          </p>
        </div>
        <ViewControls />
      </header>

      <aside className="absolute left-3 top-20 flex max-h-[calc(100dvh-11rem)] w-64 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/60 backdrop-blur max-md:hidden">
        <SiteList />
        <CustomSiteForm />
        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={() => setShowCompare(true)}
            className="w-full rounded border border-white/15 px-2 py-1.5 text-xs hover:bg-white/10"
          >
            Compare pinned sites ({compareCount}/3)
          </button>
        </div>
      </aside>

      <section
        className={`absolute right-3 top-40 bottom-28 w-[26rem] max-w-[calc(100vw-1.5rem)] max-md:left-3 max-md:top-auto max-md:w-auto ${
          selectedId ? "max-md:h-[55dvh]" : ""
        }`}
      >
        <SitePanel />
      </section>

      {showCompare && (
        <div className="absolute inset-x-3 bottom-28 top-20 z-30">
          <ComparePanel onClose={() => setShowCompare(false)} />
        </div>
      )}

      <div className="pointer-events-none absolute bottom-9 left-3 right-3 z-20">
        <TimeBar />
      </div>

      <Credits />
    </div>
  );
}
