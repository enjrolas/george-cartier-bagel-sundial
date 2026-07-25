# gc.alexhornstein.com — George Cartier Bagel Sundial

A static web toy that treats a photogrammetry scan of Montréal's **Monument
George-Étienne Cartier** as a giant sundial. For a chosen date/time it computes
the sun's position, casts the monument's shadow, takes the **farthest point of
the shadow** (the "tip"), draws the vector **base-centre → shadow-tip**, and
reports which **Montréal bagel bakery** that bearing points at.

## Layout
- `index.html` — page shell, import map for three.js, Leaflet via CDN, controls + readouts.
- `css/style.css` — dark "instrument panel" styling, no framework.
- `js/solar.js` — solar position (SunCalc-derived) + IANA-timezone → UTC helpers.
- `js/geo.js` — spherical great-circle math: `destination`, `bearingTo`, `angularDiff`, `trackOffset`, `greatCirclePath`.
- `js/viewer.js` — three.js scene: loads the model, lights it as the sun, projects every vertex to the ground to find the shadow tip, returns the tip's compass bearing.
- `js/map.js` — Leaflet map: plots the bakeries, draws the great-circle bearing line, draggable range marker with reverse geocoding.
- `js/main.js` — wires controls → sun → viewer → bearing → bakery match → readouts.
- `model/` — `3DModel.obj/.mtl/.jpg` (KIRI Engine scan). Kept `chmod 755` so Apache can read it.
- `montreal_bagel_bakeries.csv` — `name,lat,long,street_address` (35 shops).
- `deploy/` — Apache vhost config + deploy notes.

## Fixed parameters (see top of `js/main.js`)
- Monument location: `45.514204, -73.585227`, timezone `America/Toronto`.
- Model heading is a live UI slider (the object's real-world facing isn't fixed).

## Key conventions
- **World axes in the 3D scene:** `+X = East`, `−Z = North`, `+Y = Up`. North is
  fixed; the model rotates about its base-centre vertical axis (heading control).
- **Bearings** are degrees clockwise from true north everywhere.
- **Bagel match = minimum angular deviation** between the shadow bearing and the
  bearing from the monument to each shop (a pointing direction, not proximity).

## Dependencies
Loaded from CDNs at runtime — no build step, no `node_modules`:
- three.js `0.160.0` (module + `OBJLoader`, `MTLLoader`, `OrbitControls`) via jsDelivr import map.
- Leaflet `1.9.4` via unpkg (global `L`).
- Nominatim (OpenStreetMap) for reverse geocoding the draggable range marker.

## Local dev
Serve the folder over HTTP (ES modules + `fetch` need it — `file://` won't work):
```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy
See `deploy/README.md`. Static site served by Apache from this directory; the
vhost is `deploy/gc.alexhornstein.com.conf`, HTTPS added with `certbot --apache`.
