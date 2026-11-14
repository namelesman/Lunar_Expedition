# Official challenge — Lunar Landing Site Navigator (NASA Space Apps 2026)

Source: <https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/>
(retrieved 2026-11-14; categories: Advanced, Intermediate; skills: Human Exploration, Moon, Software, Space Exploration).
This file is a working summary for the team. The official page wins on any conflict.

## Summary

Missions to the Moon's south pole face extreme lighting and communication constraints.
Create an intuitive tool that lets mission planners, educators and the public **compare landing
sites and dates quickly**, visualizing **Sun and Earth positions relative to the horizon** to assess
**power generation potential** and **direct-to-Earth (DTE) communication windows**.

## Objectives (all are "may include")

| # | Objective | Where we cover it |
|---|-----------|-------------------|
| 1 | Interactive site selection and comparison: curated list (Apollo, CLPS targets, other commercial missions, other countries' landing sites) **plus custom lunar coordinates**; side-by-side or sequential comparison | `data/sites.json`, globe markers, compare panel, custom-coordinate input |
| 2 | Date and time flexibility: pick landing date/time, explore how conditions change across lunar days and seasons | date/time picker, month animation, 30-day timeline |
| 3 | Sun and Earth position visualization relative to the horizon at a site and date; **time remaining before sunset / Earthset** | sky/horizon chart with terrain profile, countdown cards |
| 4 | Power and communication assessment: solar elevation angle, duration of sunlight, Earth visibility windows | metrics cards + window chart |
| 5 | Multiple visualization approaches: 2D maps, 3D surface, creative views | 3D globe + 2D horizon panorama + charts |
| 6 | Temporal dynamics: animations / timelines over a lunar day or several days | time slider + animation + timeline |
| 7 | Accessibility across skill levels (planners, educators, public) | plain-language explanations, metric tooltips |

## Potential considerations (selected)

- Ephemeris: JPL Horizons or pre-computed datasets. We use `astronomy-engine` (VSOP87 / ELP + IAU
  lunar rotation model) and cross-check against Horizons.
- Topography: LOLA for realistic surfaces and **accurate horizon calculations**. No atmosphere, so no
  refraction: the horizon is the local terrain and the limb of the lunar sphere.
- Solar elevation is the key power metric — show it prominently.
- Clearly communicate **time before sunset or Earthset**.
- Show why small location/date changes have large impacts (south pole!).
- Consider Earth libration and the Moon's orbital variations.
- Represent steep slopes and deep craters with extreme shadows.

## Official resources

- Quickmap (LROC / ASU): <https://quickmap.lroc.asu.edu/>
- Moon Trek (NASA): <https://trek.nasa.gov/moon/>
- JPL Horizons System: <https://ssd.jpl.nasa.gov/horizons/>
- CSA Moon Exploration portal
