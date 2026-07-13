/**
 * Compact set of US ZIP codes for the patient-journey slice.
 *
 * This is intentionally a small, hand-curated subset (NOT the full US dataset).
 * It contains the 8 required test ZIPs plus the ZIP of every seeded clinic, so
 * that matching (Task 8) and leads (Task 9) have real geolocation to work with.
 *
 * lat/long/city/state values are lifted from the GeoNames US postal-code dataset
 * (same source as MedAlign-Backend/src/MedAlign.Api/Seed/Zipcodes).
 */

export type ZipCodeSeed = {
  zip: string;
  latitude: number;
  longitude: number;
  city: string;
  stateCode: string;
};

export const ZIP_CODES: ReadonlyArray<ZipCodeSeed> = [
  // --- Required test ZIPs -------------------------------------------------
  { zip: '10001', latitude: 40.7484, longitude: -73.9967, city: 'New York', stateCode: 'NY' },
  { zip: '90001', latitude: 33.9731, longitude: -118.2479, city: 'Los Angeles', stateCode: 'CA' },
  { zip: '60601', latitude: 41.8858, longitude: -87.6181, city: 'Chicago', stateCode: 'IL' },
  { zip: '33101', latitude: 25.7791, longitude: -80.1978, city: 'Miami', stateCode: 'FL' },
  { zip: '94102', latitude: 37.7813, longitude: -122.4167, city: 'San Francisco', stateCode: 'CA' },
  { zip: '98101', latitude: 47.6114, longitude: -122.3305, city: 'Seattle', stateCode: 'WA' },
  { zip: '30301', latitude: 33.8444, longitude: -84.4741, city: 'Atlanta', stateCode: 'GA' },
  { zip: '02108', latitude: 42.3576, longitude: -71.0684, city: 'Boston', stateCode: 'MA' },
  // --- Additional ZIPs used by seeded clinics -----------------------------
  { zip: '78701', latitude: 30.2711, longitude: -97.7437, city: 'Austin', stateCode: 'TX' },
  { zip: '85001', latitude: 33.4484, longitude: -112.074, city: 'Phoenix', stateCode: 'AZ' },
];
