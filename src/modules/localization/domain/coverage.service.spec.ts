import { CoverageService } from './coverage.service';
import type { ClinicRecord, LocationRecord, ServiceRecord } from './coverage.types';

const loc = (over: Partial<LocationRecord> = {}): LocationRecord => ({
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: '',
  intro: '',
  aliases: ['tpa'],
  nearSlugs: ['sarasota'],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
  ...over,
});
const svc = (over: Partial<ServiceRecord> = {}): ServiceRecord => ({
  slug: 'hormone-optimization',
  name: 'Hormone Optimization',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
  ...over,
});
const clinic = (over: Partial<ClinicRecord> = {}): ClinicRecord => ({
  id: 'c1',
  name: 'C1',
  cityText: 'Tampa',
  city: 'tampa',
  stateCode: 'FL',
  services: ['trt'],
  telehealth: false,
  ...over,
});

describe('CoverageService', () => {
  const s = new CoverageService();
  const codes = ['trt', 'bhrt'];

  it('resolveCitySlug matches name, slug, and alias case-insensitively', () => {
    const locs = [loc()];
    expect(s.resolveCitySlug('Tampa', locs)).toBe('tampa');
    expect(s.resolveCitySlug('tampa', locs)).toBe('tampa');
    expect(s.resolveCitySlug('TPA', locs)).toBe('tampa');
    expect(s.resolveCitySlug('Orlando', locs)).toBeNull();
  });

  it('localClinicsInCity counts in-city clinics (including telehealth ones) and excludes out-of-city telehealth clinics', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa' }),
      clinic({ id: 'b', city: 'tampa', telehealth: true }),
      clinic({ id: 'c', city: 'miami', telehealth: true }),
    ];
    expect(s.localClinicsInCity(clinics, 'tampa').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('telehealthForCity returns active telehealth clinics physically outside the city, not in-city telehealth or non-telehealth out-of-city clinics', () => {
    const clinics = [
      clinic({ id: 'a', city: 'miami', telehealth: true }), // out-of-city + telehealth -> surfaced
      clinic({ id: 'b', city: 'miami', telehealth: false }), // out-of-city but not telehealth -> excluded
      clinic({ id: 'c', city: 'tampa', telehealth: true }), // in-city telehealth -> already local, excluded here
    ];
    expect(s.telehealthForCity(clinics, 'tampa').map((c) => c.id)).toEqual(['a']);
  });

  it('clinicsForService matches any mapped code', () => {
    const clinics = [
      clinic({ id: 'a', services: ['bhrt'] }),
      clinic({ id: 'b', services: ['ed'] }),
    ];
    expect(s.clinicsForService(clinics, codes).map((c) => c.id)).toEqual(['a']);
  });

  it('cityPublished requires status available AND counts only clinics physically in the city >= min', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa' }),
      clinic({ id: 'b', city: 'miami', telehealth: true }),
    ];
    expect(s.cityPublished(loc(), clinics, 1)).toBe(true);
    expect(s.cityPublished(loc(), clinics, 2)).toBe(false);
    expect(s.cityPublished(loc({ status: 'coming_soon' }), clinics, 1)).toBe(false);
  });

  it('cityPublished counts an in-city telehealth clinic toward the gate (not skipped), including strictly-above-threshold', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa', telehealth: false }),
      clinic({ id: 'b', city: 'tampa', telehealth: true }),
    ];
    // If in-city telehealth were wrongly excluded, the count would be 1 and this would be false.
    expect(s.cityPublished(loc(), clinics, 2)).toBe(true);
    // Strictly above threshold: count (2) > min (1).
    expect(s.cityPublished(loc(), clinics, 1)).toBe(true);
  });

  it('cityPublished excludes an out-of-city telehealth clinic, which telehealthForCity surfaces separately', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa' }),
      clinic({ id: 'b', city: 'miami', telehealth: true }),
      clinic({ id: 'c', city: 'miami', telehealth: false }),
    ];
    expect(s.cityPublished(loc(), clinics, 2)).toBe(false);
    expect(s.telehealthForCity(clinics, 'tampa').map((c) => c.id)).toEqual(['b']);
  });

  it('servicePublished requires status active AND count >= min', () => {
    const clinics = [
      clinic({ id: 'a', services: ['trt'] }),
      clinic({ id: 'b', services: ['bhrt'] }),
    ];
    expect(s.servicePublished(svc(), clinics, codes, 2)).toBe(true);
    expect(s.servicePublished(svc({ status: 'hidden' }), clinics, codes, 2)).toBe(false);
    expect(s.servicePublished(svc(), clinics, codes, 3)).toBe(false);
  });

  it('servicePublished counts telehealth providers toward the statewide gate regardless of physical city', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa', services: ['trt'], telehealth: false }),
      clinic({ id: 'b', city: 'miami', services: ['bhrt'], telehealth: true }),
    ];
    // If telehealth were excluded from the statewide gate, the count would be 1 and this would be false.
    expect(s.servicePublished(svc(), clinics, codes, 2)).toBe(true);
  });

  it('comboPublished requires available city, active service, and local matching count >= min', () => {
    const clinics = [
      clinic({ id: 'a', city: 'tampa', services: ['trt'] }),
      clinic({ id: 'b', city: 'tampa', services: ['bhrt'] }),
      clinic({ id: 'c', city: 'miami', services: ['trt'] }),
    ];
    expect(s.comboPublished(loc(), svc(), clinics, codes, 2)).toBe(true);
    expect(s.comboPublished(loc({ status: 'coming_soon' }), svc(), clinics, codes, 2)).toBe(false);
    expect(s.comboPublished(loc(), svc(), clinics, codes, 3)).toBe(false);
  });
});
