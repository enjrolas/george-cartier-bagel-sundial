# gc.alexhornstein.com — George Cartier Bagel Sundial

A static web toy that treats a photogrammetry scan of Montréal's **Monument
George-Étienne Cartier** (101 ft / ~31 m tall) as a giant sundial. For a
date/time it computes the sun's position, projects the shadow of the monument's
**apex** to the ground, takes the vector **base-centre → shadow-tip**, and reports
which **Montréal bagel bakery** that bearing points at (minimum angular deviation).

Four endpoints share the same solar/geo math and shadow-bearing:
- `/` — the interactive 3D map (statue at true scale, milled-steel **dial**, and a
  green **matrix-bagel triangle** along the shadow bearing).
- `/ar/` — **WebXR** (ARCore/Android), **GPS-gated to the monument**: plant the
  milled-steel dial on the real ground; a matrix-green triangle sweeps to a bagel.
- `/anywhere/` — "George Anywhere": compass-HUD AR (iOS+Android) — bagel shops at
  their true bearings from the monument + the shadow pointer, usable anywhere.
- `/watch/` — MediaPipe wrist AR: a tiny statue on your wrist whose Montréal
  shadow points you to a bagel shop within 10 km of *you*, anywhere in the world.

Shared pieces: `js/matrixtri.js` (the 2D matrix-bagel triangle used by the AR
overlays); `model/3DModel-lowpoly.obj` (353 KB, AR) and `model/3DModel-main.obj`
(942 KB, the `/` view) — both vertex-clustered from the scan with baked vertex
colours (no texture). Regenerate with `scratchpad/decimate.py <DIV> <out>`.

## Layout
- `index.html`, `css/style.css` — the 3D map page + dark "instrument panel" styling.
- `js/solar.js` — solar position (SunCalc-derived) + IANA-timezone → UTC helpers.
- `js/geo.js` — great-circle math: `destination`, `bearingTo`, `angularDiff`, `trackOffset`, `haversine`, `greatCirclePath`.
- `js/viewer.js` — the unified three.js scene: **map plane textured from OSM tiles**
  (wide z11 city map + lazy hi-res z18 patch near the statue), the model at true
  scale, apex-shadow tip, bakery pins, and the pointing beam to the target.
- `js/main.js` — wires controls → sun → viewer → bearing → bakery match → readouts.
- `ar/` — `/ar/` endpoint: `index.html`, `style.css`, `ar.js`.
- `watch/` — `/watch/` endpoint: `index.html`, `style.css`, `watch.js`.
- `model/` — `3DModel.obj/.mtl/.jpg` (KIRI Engine scan). `chmod 755` so Apache can read it.
- `montreal_bagel_bakeries.csv` — `name,lat,long,street_address` (35 shops, used by `/` only).
- `deploy/` — Apache vhost config + deploy notes.

## Fixed parameters
- Monument location `45.514204, -73.585227`, timezone `America/Toronto` (top of `js/main.js`).
- **Model heading is fixed at 207°** (`HEADING` in `js/main.js`) — the monument's real facing.
- Statue height `30.78 m` (101 ft); apex world position after heading/scale is the
  constant `APEX` in `ar/ar.js` and `watch/watch.js` (so AR needs no 3D model).
- Time defaults to the current Montréal time; a slider scrubs the day (`/`).

## Key conventions
- **World axes:** `+X = East`, `−Z = North`, `+Y = Up`. Bearings are degrees CW from true north.
- **Shadow tip = ground shadow of the apex** (not the farthest silhouette point,
  which is unstable at high sun). Keeps the bearing near anti-solar and stable.
- **Bagel match = minimum angular deviation** between the shadow bearing and the
  bearing to each shop (a pointing direction, not proximity).

## Dependencies (all CDN, no build step)
- three.js `0.160.0` (module + `OBJLoader`/`MTLLoader`/`OrbitControls`) via jsDelivr import map.
- OpenStreetMap raster tiles (map texture); **Nominatim** search (nearby bagels in `/watch`).
- MediaPipe Hands + camera_utils (wrist tracking in `/watch`), loaded lazily.
- `/` no longer uses Leaflet — the map is a texture on a three.js ground plane.

## Local dev
Serve over HTTP (ES modules + `fetch` need it): `python3 -m http.server 8000`.
Note: camera/compass/geolocation (`/ar`, `/watch`) require **HTTPS** — test those on the live host.

## Deploy
See `deploy/README.md`. Static site served by Apache from this directory; `/ar` and
`/watch` are subdirectories served via `DirectoryIndex`. HTTPS via `certbot --apache`.
