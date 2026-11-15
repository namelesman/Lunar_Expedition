# Space Apps 2026 submission — Lunar Landing Site Navigator

Text for the submission form, ready to paste. Every number here comes from the tests and
measurements in the [README](../README.md).

- **Challenge:** [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)
- **Live app:** <https://lunar-expedition.vercel.app>
- **Source code:** <https://github.com/namelesman/Lunar_Expedition> (Apache-2.0)
- **Local event:** Recife, Brazil

## High-level project summary

Two questions decide whether a lunar lander survives. Will it see the Sun, for power? Will it see
the Earth, for direct communication? Near the south pole the answers change from one crater rim to
the next and from one month to the next.

The Lunar Landing Site Navigator answers both in seconds, for any site and date. On a real-time 3D
Moon built from NASA LRO data, you can pick an Apollo, CLPS or international landing site, or any
coordinates. The app then shows:

- where the Sun and the Earth are against the site's real terrain horizon, computed from NASA LOLA
  elevation data;
- how long until sunset or Earthset;
- the power and direct-to-Earth windows for the next 30 days;
- how they change over the next 12 lunations;
- the solar energy a panel would receive;
- a 20 × 20 km map of the best-lit and best-connected spots nearby, with a rover route to any of
  them.

Everything runs in the browser, needs no account, and is checked against JPL Horizons.

## Project details

### What it does

- **Sites and dates.** The app includes 15 curated sites: Apollo, CLPS (IM-1, IM-2, Blue Ghost),
  Chandrayaan-3, SLIM, Chang'e 4 and 6, and the Shackleton crater. Every coordinate cites its
  official source. The Artemis III regions are listed without coordinates, because NASA published
  them only on a map, and we did not invent any. You can also enter any coordinates or double-click
  the Moon. Pick any date and time, play the month, or pin up to three sites side by side.
- **Sun and Earth against the real horizon.** The terrain horizon is computed for each site from
  LOLA elevation data:
  - 720 azimuths, every 0.5°;
  - terrain up to 300 km away;
  - exact lunar curvature;
  - an observer 2 m above the ground;
  - no refraction, since the Moon has no atmosphere.

  For the selected moment, cards show each body's elevation, the share of its disk that is
  visible, and the countdown to sunset or sunrise and Earthset or Earthrise.
- **Power and communication windows.** A 360° panorama shows the horizon with the Sun and Earth
  tracks. A 30-day timeline shows the sunlight, Earth-visibility and both-at-once windows, with
  the Sun's elevation plotted against the terrain. The metrics include the longest night and the
  longest communication gap.
- **Seasons.** For each of the next 12 lunations, the app gives the sunlit share, the
  Earth-visible share and the longest night. At the poles, the Moon's 1.54° axial tilt and its
  libration make these change through the year. For example, IM-2 is sunlit between 36 % and 53 %
  of the time, depending on the lunation.
- **Sunlight map around a site.** On demand, the browser computes the terrain horizon of 1,681
  points (a 500 m grid over 20 × 20 km). It then maps how often each point sees the Sun and the
  Earth, and also shows the shadows at the selected moment. At Shackleton the crater floor is in
  permanent shadow (0 %), while the rim, 10 km away, is sunlit 96 % of the time. Clicking a spot
  opens it as a new site.
- **Rover routes.** From the site to any spot of that map, the app finds the cheapest drivable
  path (A* over terrain points 100 m apart). Ground steeper than a slope limit (15° by default) is
  impassable, and the route can prefer sunlit ground. It reports the distance, driving time, climb
  and steepest slope, with an elevation profile. From IM-2, the best-lit spot 10 km west is
  11.2 km away by a route that never exceeds 8°. From the Shackleton crater floor there is no route
  out under 25°.
- **Solar energy.** The app estimates the sunlight reaching 1 m² of panel over 30 days, from the
  Sun's distance, the visible share of its disk and the panel's angle. At IM-2 a vertical panel
  facing the Sun averages 726 W/m², but a flat one only 58 W/m², because the Sun stays low. At
  Apollo 11 both average 437 W/m².
- **Real sky.** The Sun and the Earth are drawn at their true directions and apparent sizes over
  NASA's star map, and the Earth shows its true phase.
- **For every audience.** The app includes a help and glossary dialog, a phone layout, labelled
  controls, and table views of the charts.

### How it works

- **Ephemeris.** The app uses `astronomy-engine` with the IAU lunar rotation model, including
  topocentric parallax for the Earth. Tests check it against JPL Horizons (DE441) at three sites,
  to 0.01° in elevation and 0.05° in azimuth.
- **Terrain.** The data are LOLA rasters from the SVS CGI Moon Kit, plus the LOLA GDR polar DEMs
  at 80 m south of 80°S. For the curated sites, the horizons are precomputed. For any other point,
  a Web Worker downloads only the terrain tiles it needs (about 2–4 MB) and runs the same horizon code
  in the browser. Tiling is lossless: the tiled path reproduces the precomputed horizons exactly.
  If tiles fail, the app falls back to a smooth sphere and says so.
- **3D Moon.** The globe is NASA's LRO model (LROC colour, LOLA relief). Its mesh is distorted
  near the poles, so poleward of 80° the browser rebuilds the relief from the LOLA polar DEMs
  (about 950 m per point, 0.9 MB per pole).
- **Stack.** TypeScript end to end:
  - Next.js and React Three Fiber (three.js) for the app and the 3D view;
  - a pure, tested core package;
  - a Node data pipeline that downloads the NASA files, checks their SHA-256 and builds the
    tiles.

  The app runs as a static site on Vercel. It has no backend, no cookies and no analytics.

### Benefits

Mission planners can screen sites and landing dates for power and communication in seconds, and
see why a 5 km shift or a one-month delay matters. Educators and the public get an intuitive,
accurate picture of lunar day, night and seasons, and of why the south pole is so hard.

### Tools and languages

TypeScript, Next.js 16, React 19, three.js and React Three Fiber, zustand, astronomy-engine,
geotiff.js, sharp, esbuild, Vitest and Vercel.

## Use of Artificial Intelligence

The code, tests and documentation were written with an AI coding assistant (Claude Code, by
Anthropic), working from the team's requirements. The physics and data handling are checked by
automated tests against independent references: JPL Horizons for the ephemeris, and the full LOLA
rasters for the tiled terrain.

All data and imagery in the app are NASA's: the LRO Moon model and mosaics, the LOLA elevation
models, the Deep Star Maps and the Blue Marble. None of it was generated by AI. The app itself
uses no AI at run time.

## NASA data and resources

| Data | Use | Link |
| --- | --- | --- |
| LRO 3D Moon model (LROC color + LOLA topography), NASA SVS | 3D globe | <https://svs.gsfc.nasa.gov/14959> |
| CGI Moon Kit: LOLA `ldem_64` / `ldem_16` and the LROC color map, NASA SVS | Terrain horizons and tiles, textures | <https://svs.gsfc.nasa.gov/4720> |
| LOLA GDR polar DEMs `LDEM_80S_80M`, `LDEM_75S_120M` (PDS Geosciences Node and imbrium.mit.edu mirror) | 80 m / 960 m south-polar terrain | <https://pds-geosciences.wustl.edu/missions/lro/lola.htm> |
| Deep Star Maps 2020, NASA SVS | Star background, oriented for the date | <https://svs.gsfc.nasa.gov/4851> |
| Blue Marble Next Generation, NASA Earth Observatory | Earth texture | <https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/> |
| JPL Horizons (DE441) | Reference values for the ephemeris tests | <https://ssd.jpl.nasa.gov/horizons/> |
| LRO LOLA and LROC mission pages | Credits and documentation | <https://lola.gsfc.nasa.gov/>, <https://www.lroc.asu.edu/> |
| NASA, CLPS and mission pages | Landing-site coordinates (cited per site in `data/sites.json`) | per site |

### Space agency partner data

None. The landing positions of Chandrayaan-3 (ISRO), SLIM (JAXA) and Chang'e 4 and 6 (CNSA) come
from NASA LRO / LROC observations of the landers, cited for each site in `data/sites.json`.

## References

- `astronomy-engine` (Don Cross, MIT): ephemeris and IAU lunar rotation model.
- IAU WGCCRE report (Archinal et al.): cartographic coordinates and rotational elements.
- Smith et al., LOLA instrument and data products (PDS).
- three.js, React Three Fiber, drei, Next.js, zustand, geotiff.js, sharp.

## Demo materials

- **Slides (≤ 7):** see the deck linked from the submission.
- **30-second video:** storyboard below. It is recorded from the live app.

| Time | Shot |
| --- | --- |
| 0–4 s | 3D Moon with real sky; title "Will it see the Sun? Will it see the Earth?" |
| 4–10 s | Select IM-2 (Mons Mouton): the cards show Sun and Earth against the real horizon, with a sunrise countdown |
| 10–16 s | Local-sky panorama and 30-day power/comms timeline; click to move the clock |
| 16–23 s | Sunlight map around Shackleton: dark crater floor, bright rim; "Shadows now" while the clock plays |
| 23–28 s | Next 12 lunations: polar seasons |
| 28–30 s | URL and "NASA LRO · LOLA · SVS" credits |
