// Spherical-earth great-circle helpers. Bearings in degrees clockwise from true north.

const R = 6371; // km
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/**
 * Destination point from (lat,lon) travelling `distanceKm` along `bearingDeg`.
 * @returns {[number, number]} [lat, lon] degrees
 */
export function destination(lat, lon, bearingDeg, distanceKm) {
  const δ = distanceKm / R;
  const θ = bearingDeg * RAD;
  const φ1 = lat * RAD;
  const λ1 = lon * RAD;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return [φ2 * DEG, normLon(λ2 * DEG)];
}

/** Great-circle distance between two points, km. */
export function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = lat1 * RAD, φ2 = lat2 * RAD;
  const dφ = (lat2 - lat1) * RAD;
  const dλ = (lon2 - lon1) * RAD;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Sample a great-circle path from an origin along a bearing out to maxKm.
 * Returns an array of [lat, lon], splitting into segments that never wrap the
 * antimeridian mid-segment (Leaflet draws each sub-array as its own polyline).
 */
export function greatCirclePath(lat, lon, bearingDeg, maxKm, steps = 240) {
  const segments = [];
  let current = [];
  let prevLon = null;
  for (let i = 0; i <= steps; i++) {
    const d = (maxKm * i) / steps;
    const [la, lo] = destination(lat, lon, bearingDeg, d);
    if (prevLon !== null && Math.abs(lo - prevLon) > 180) {
      // crossed the antimeridian — break the polyline
      segments.push(current);
      current = [];
    }
    current.push([la, lo]);
    prevLon = lo;
  }
  if (current.length) segments.push(current);
  return segments;
}

function normLon(lon) {
  return ((lon + 540) % 360) - 180;
}
