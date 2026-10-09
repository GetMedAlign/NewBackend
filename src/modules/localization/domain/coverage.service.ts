import { Injectable } from '@nestjs/common';
import type {
  ClinicRecord,
  LocationRecord,
  RawClinicRecord,
  ServiceRecord,
} from './coverage.types';

/**
 * Telehealth semantics: `city` is a clinic's physical-address city; `telehealth` means it
 * ALSO offers remote visits. The CITY gate (`cityPublished`) and COMBO gate count clinics
 * PHYSICALLY in the city (`city === slug`) - an in-city clinic that also offers telehealth
 * IS a real local clinic and counts; an out-of-city telehealth clinic does not count toward
 * a city's gate and is surfaced separately via `telehealthForCity`. The SERVICE gate
 * (`servicePublished`) is statewide, so it counts ALL active clinics offering the service,
 * including telehealth providers regardless of their physical city.
 */
@Injectable()
export class CoverageService {
  private norm(s: string): string {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/(florida|fl)$/, '');
  }

  resolveCitySlug(cityText: string, locations: LocationRecord[]): string | null {
    const n = this.norm(cityText);
    if (!n) return null;
    const match = locations.find(
      (l) =>
        this.norm(l.name) === n ||
        this.norm(l.slug) === n ||
        l.aliases.some((a) => this.norm(a) === n),
    );
    return match ? match.slug : null;
  }

  toClinicRecords(raws: RawClinicRecord[], locations: LocationRecord[]): ClinicRecord[] {
    return raws.map((r) => ({
      id: r.id,
      name: r.name,
      cityText: r.cityText,
      city: this.resolveCitySlug(r.cityText, locations) ?? '',
      stateCode: r.stateCode,
      services: r.services,
      telehealth: r.telehealth,
    }));
  }

  localClinicsInCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[] {
    return clinics.filter((c) => c.city === citySlug);
  }

  telehealthForCity(clinics: ClinicRecord[], citySlug: string): ClinicRecord[] {
    return clinics.filter((c) => c.telehealth && c.city !== citySlug);
  }

  clinicsForService(clinics: ClinicRecord[], codes: string[]): ClinicRecord[] {
    const set = new Set(codes);
    return clinics.filter((c) => c.services.some((code) => set.has(code)));
  }

  clinicsForCombo(clinics: ClinicRecord[], citySlug: string, codes: string[]): ClinicRecord[] {
    const set = new Set(codes);
    return clinics.filter((c) => c.city === citySlug && c.services.some((code) => set.has(code)));
  }

  cityPublished(location: LocationRecord, clinics: ClinicRecord[], minClinics: number): boolean {
    return (
      location.status === 'available' &&
      this.localClinicsInCity(clinics, location.slug).length >= minClinics
    );
  }

  servicePublished(
    service: ServiceRecord,
    clinics: ClinicRecord[],
    codes: string[],
    minClinics: number,
  ): boolean {
    return (
      service.status === 'active' && this.clinicsForService(clinics, codes).length >= minClinics
    );
  }

  comboPublished(
    location: LocationRecord,
    service: ServiceRecord,
    clinics: ClinicRecord[],
    codes: string[],
    minClinics: number,
  ): boolean {
    return (
      location.status === 'available' &&
      service.status === 'active' &&
      this.clinicsForCombo(clinics, location.slug, codes).length >= minClinics
    );
  }
}
