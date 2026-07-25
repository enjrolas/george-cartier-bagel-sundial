// Leaflet map: origin marker, great-circle bearing line, and a draggable range
// marker whose position is reverse-geocoded to a place name.

import { destination, greatCirclePath, haversine } from './geo.js';

const MAX_KM = 20015; // half the earth's circumference — the antipode

export function createMap(elId, origin) {
  const map = L.map(elId, { worldCopyJump: true, zoomControl: true }).setView([origin.lat, origin.lon], 3);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);

  const originMarker = L.circleMarker([origin.lat, origin.lon], {
    radius: 6, color: '#ffb454', weight: 2, fillColor: '#ffb454', fillOpacity: 0.9,
  }).addTo(map).bindTooltip('Object', { permanent: false });

  const line = L.polyline([], { color: '#4fd0e3', weight: 2, opacity: 0.9 }).addTo(map);

  const rangeMarker = L.marker([origin.lat, origin.lon], { draggable: true, autoPan: true }).addTo(map);
  const label = L.tooltip({ permanent: true, direction: 'top', className: 'marker-label', offset: [0, -8] });
  rangeMarker.bindTooltip(label);

  let bearing = 0;
  let distanceKm = 3000;
  let markerCb = () => {};      // ({lat,lon,km}) => void  (fires whenever the marker moves)
  let geocodeTimer = null;

  function setBearing(b) {
    bearing = b;
    redrawLine();
    placeMarker(distanceKm, true);
  }

  function setDistance(km, doGeocode = true) {
    distanceKm = Math.max(0, Math.min(MAX_KM, km));
    placeMarker(distanceKm, doGeocode);
  }

  function redrawLine() {
    const segs = greatCirclePath(origin.lat, origin.lon, bearing, MAX_KM);
    line.setLatLngs(segs);
  }

  function placeMarker(km, doGeocode) {
    const [lat, lon] = destination(origin.lat, origin.lon, bearing, km);
    rangeMarker.setLatLng([lat, lon]);
    label.setContent(`${fmt(lat)}, ${fmt(lon)} · ${Math.round(km).toLocaleString()} km`);
    rangeMarker.openTooltip();
    markerCb({ lat, lon, km });
    if (doGeocode) scheduleGeocode(lat, lon);
    return [lat, lon];
  }

  // While dragging, snap the marker back onto the bearing line at the
  // great-circle distance nearest the dropped point.
  rangeMarker.on('drag', () => {
    const p = rangeMarker.getLatLng();
    const km = Math.min(MAX_KM, haversine(origin.lat, origin.lon, p.lat, p.lng));
    distanceKm = km;
    const [lat, lon] = destination(origin.lat, origin.lon, bearing, km);
    rangeMarker.setLatLng([lat, lon]);
    label.setContent(`${fmt(lat)}, ${fmt(lon)} · ${Math.round(km).toLocaleString()} km`);
    markerCb({ lat, lon, km }); // update the slider + readout live
  });
  rangeMarker.on('dragend', () => {
    const p = rangeMarker.getLatLng();
    scheduleGeocode(p.lat, p.lng);
  });

  let placeCb = () => {};
  function scheduleGeocode(lat, lon) {
    placeCb({ loading: true });
    clearTimeout(geocodeTimer);
    geocodeTimer = setTimeout(() => reverseGeocode(lat, lon).then(placeCb), 600);
  }

  return {
    setBearing,
    setDistance,
    onMarker(cb) { markerCb = cb; },
    onPlace(cb) { placeCb = cb; },
    invalidate() { map.invalidateSize(); },
  };
}

function fmt(v) {
  const s = Math.abs(v).toFixed(3);
  return v >= 0 ? s : '-' + s;
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (data && data.display_name) return { name: data.display_name };
    if (data && data.error) return { name: 'Open ocean — no landfall here' };
    return { name: 'Open ocean — no landfall here' };
  } catch (e) {
    return { name: 'Location lookup unavailable' };
  }
}
