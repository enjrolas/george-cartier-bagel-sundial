// Solar position (SunCalc-derived algorithm) + timezone helpers.
// Returns a compass azimuth (degrees clockwise from true north) and altitude (degrees).

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397; // Earth's axial tilt

function toDays(date) {
  return date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
}
function solarMeanAnomaly(d) {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(M) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}
function declination(l) {
  return Math.asin(Math.sin(0) * Math.cos(OBLIQUITY) + Math.cos(0) * Math.sin(OBLIQUITY) * Math.sin(l));
}
function rightAscension(l) {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(0) * Math.sin(OBLIQUITY), Math.cos(l));
}
function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

// azimuth here is measured from due south, positive toward west (SunCalc convention).
function azimuthFromSouth(H, phi, dec) {
  return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
}
function altitude(H, phi, dec) {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
}

/**
 * @param {Date} date  UTC instant
 * @param {number} lat degrees
 * @param {number} lon degrees
 * @returns {{azimuth:number, altitude:number}} azimuth = compass degrees (0=N, 90=E), altitude = degrees above horizon
 */
export function getSunPosition(date, lat, lon) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;

  const azSouth = azimuthFromSouth(H, phi, dec); // radians, 0 = south, +west
  const alt = altitude(H, phi, dec);

  // Convert "from south, +west" to compass "from north, clockwise".
  let compass = (azSouth / RAD + 180) % 360;
  if (compass < 0) compass += 360;

  return { azimuth: compass, altitude: alt / RAD };
}

// --- timezone: interpret a wall-clock time in an IANA zone as a UTC instant ---

function tzOffsetMs(utcMillis, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMillis));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - utcMillis; // local - utc
}

/**
 * Build the UTC Date for a wall-clock date/time in the given IANA timezone.
 * @param {string} dateStr "YYYY-MM-DD"
 * @param {string} timeStr "HH:MM"
 * @param {string} timeZone e.g. "America/Toronto"
 */
export function zonedToUTC(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess - offset);
}

/** Short timezone abbreviation (e.g. "EDT") for display. */
export function tzAbbrev(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
  const tz = parts.find(p => p.type === 'timeZoneName');
  return tz ? tz.value : timeZone;
}
