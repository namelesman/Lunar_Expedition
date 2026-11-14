import { MOON_RADIUS_KM } from "@lunar/core";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-black p-8 text-neutral-100">
      <h1 className="text-3xl font-semibold tracking-tight">Lunar Landing Site Navigator</h1>
      <p className="max-w-xl text-center text-neutral-400">
        Compare lunar landing sites and dates: Sun and Earth positions relative to the real
        terrain horizon, power and direct-to-Earth communication windows.
      </p>
      <p className="text-sm text-neutral-500">Reference radius: {MOON_RADIUS_KM} km · 3D globe loading soon.</p>
    </main>
  );
}
