import type {
  LocationRecord,
  RawClinicRecord,
  ServiceCodeMap,
  ServiceRecord,
} from '../coverage.types';

export interface LocalizationRepositoryPort {
  loadActiveClinics(): Promise<RawClinicRecord[]>;
  getLocations(includeHidden: boolean): Promise<LocationRecord[]>;
  getLocationBySlug(slug: string): Promise<LocationRecord | null>;
  getServices(includeHidden: boolean): Promise<ServiceRecord[]>;
  getServiceBySlug(slug: string): Promise<ServiceRecord | null>;
  getServiceCodeMap(): Promise<ServiceCodeMap>;
  getMinClinics(): Promise<number>;
  insertNotify(email: string, citySlug: string | null): Promise<void>;
}

export const LOCALIZATION_REPOSITORY = Symbol('LocalizationRepositoryPort');
