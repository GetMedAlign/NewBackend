const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine formula — returns the great-circle distance in miles between two
 * lat/lng points. Earth radius: 3958.8 miles.
 */
export function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const a = sinDLat * sinDLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}
