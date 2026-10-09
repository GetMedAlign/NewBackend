export type LocationStatus = 'available' | 'coming_soon' | 'hidden';
export type ServiceStatus = 'active' | 'hidden';
export type CoverageCellState = 'published' | 'below_threshold' | 'none';

export interface RawClinicRecord {
  id: string;
  name: string;
  cityText: string;
  stateCode: string;
  services: string[];
  telehealth: boolean;
}

export interface ClinicRecord {
  id: string;
  name: string;
  cityText: string; // original clinic city text, for display
  city: string; // resolved location slug, or '' when unmatched
  stateCode: string;
  services: string[];
  telehealth: boolean;
}

export interface LocationRecord {
  slug: string;
  name: string;
  stateCode: string;
  status: LocationStatus;
  area: string;
  intro: string;
  aliases: string[];
  nearSlugs: string[];
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
}

export interface ServiceRecord {
  slug: string;
  name: string;
  description: string;
  status: ServiceStatus;
  relatedSlugs: string[];
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
}

export type ServiceCodeMap = Record<string, string[]>; // serviceSlug -> service codes
