# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026 — challenge
[*Lunar Landing Site Navigator*](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).
Team from Recife, Brazil.

A web app to compare lunar landing sites and dates in seconds: where the **Sun** and the **Earth**
are relative to the **real terrain horizon** at each site, how long until sunset / Earthset, and the
power and direct-to-Earth communication windows over the coming weeks — on a real-time 3D Moon built
from NASA LRO data.

> Work in progress (hackathon, 14–15 Nov 2026). See [`docs/challenge.md`](docs/challenge.md) for the
> official objectives and how each one maps to the app.

## Repository layout

```
apps/web/        Next.js (App Router) + TypeScript — UI, 3D globe, /api routes
packages/core/   Pure, tested logic: shared types, lat/lon → 3D, Sun/Earth geometry, horizon, A*
scripts/         Node + TypeScript data pipeline (GLB optimization, horizon masks, terrain grids, fixtures)
data/            sites.json (curated landing sites with official sources)
docs/            Challenge summary and design notes
```

Raw NASA files (TIFF/EXR/GLB) and generated tiles are **never committed**; the scripts in
`scripts/` download and regenerate everything.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (packages/core)
npm run check      # typecheck + tests + production build
```

### Data pipeline (Node + TypeScript, `scripts/`)

Everything runs on Node 22+ with `tsx`; no Python. Raw NASA files go in `data/raw/` (git-ignored).

```bash
npm run glb:optimize -- path/to/Moon_NASA_LRO_8k_Topo.glb apps/web/public/models   # SVS #14959 → web GLBs
npm run glb:fit -w @lunar/scripts      # calibrate the GLB against LOLA (needs data/raw/svs-4720/ldem_16_uint.tif)
npm run data:horizons                  # horizon masks per site (needs ldem_64_uint.tif)
npm run data:fixtures                  # albedo fixture for the core tests
npm run sky:textures                   # star map (SVS #4851 starmap_2020_8k.exr) + Earth (Blue Marble NG)
npm run assets:stage                   # stage models + sky for the static assets project
```

Heavy web assets (optimized GLBs, star map) are git-ignored and served from a separate static
Vercel project (`NEXT_PUBLIC_ASSETS_BASE_URL`); `npm run assets:stage` then
`vercel deploy --prod` in `data/cache/assets-site` publishes them.

## Data and credits

- NASA's Scientific Visualization Studio — CGI Moon Kit and the LRO 8k topographic Moon model.
- Lunar Reconnaissance Orbiter Camera (LROC), NASA / GSFC / Arizona State University.
- Lunar Orbiter Laser Altimeter (LOLA), NASA / GSFC.
- NASA SVS Deep Star Maps 2020 (svs.gsfc.nasa.gov/4851) — background sky, oriented for the selected date.
- NASA Earth Observatory Blue Marble Next Generation (Reto Stöckli) — Earth texture.

The Sun and the Earth in the 3D view are drawn at their true directions and apparent sizes
(≈0.53° and ≈1.9° from the Moon), with an optional 4× "not to scale" mode; the Earth shows its real
phase and the face turned toward the Moon at that instant.

## License

[Apache-2.0](LICENSE)
