"use client";

import type { Site } from "@lunar/core";
import dynamic from "next/dynamic";

// The whole tool depends on the current time and WebGL: render it on the client only.
const App = dynamic(() => import("./App").then((m) => m.App), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-2 bg-black text-neutral-400">
      <span className="text-lg font-semibold text-neutral-100">
        Lunar Landing Site Navigator
      </span>
      <span className="text-sm">Loading…</span>
    </div>
  ),
});

export function ClientApp({ initialSites }: { initialSites: Site[] }) {
  return <App initialSites={initialSites} />;
}
