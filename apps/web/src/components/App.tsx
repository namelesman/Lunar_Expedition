"use client";

import type { Site, Vec3 } from "@lunar/core";
import dynamic from "next/dynamic";
import { useEffect, useMemo } from "react";
import { useApp } from "@/lib/store";
import { Credits } from "./ui/Credits";
import { ViewControls } from "./ui/ViewControls";
import { SiteList } from "./ui/SiteList";

const MoonScene = dynamic(() => import("./globe/MoonScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">Loading 3D Moon…</div>
  ),
});

export function App({ initialSites }: { initialSites: Site[] }) {
  const setSites = useApp((s) => s.setSites);
  const setQuality = useApp((s) => s.setQuality);

  useEffect(() => setSites(initialSites), [initialSites, setSites]);

  // Placeholder light until the ephemeris module drives it.
  const sunDirection = useMemo<Vec3>(() => ({ x: 0.8, y: 0.15, z: 0.6 }), []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black text-neutral-100">
      <div className="absolute inset-0">
        <MoonScene
          sunDirection={sunDirection}
          onCapabilities={(max) => {
            const weak =
              max < 8192 ||
              (typeof navigator !== "undefined" &&
                "deviceMemory" in navigator &&
                Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) < 4);
            if (weak) setQuality("lite");
          }}
        />
      </div>

      <header className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto">
          <h1 className="text-lg font-semibold tracking-tight">Lunar Landing Site Navigator</h1>
          <p className="text-xs text-neutral-400">Sun · Earth · terrain horizon — compare sites and dates</p>
        </div>
        <ViewControls />
      </header>

      <aside className="absolute bottom-16 left-4 top-20 w-72 max-w-[calc(100vw-2rem)]">
        <SiteList />
      </aside>

      <Credits />
    </div>
  );
}
