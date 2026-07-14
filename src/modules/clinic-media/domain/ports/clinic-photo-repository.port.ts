export const CLINIC_PHOTO_REPOSITORY = Symbol('ClinicPhotoRepository');

export interface ClinicPhotoRepositoryPort {
  getLogoUrl(clinicId: string): Promise<string | null>;
  setLogoUrl(clinicId: string, url: string): Promise<void>;
  listPhotoUrls(clinicId: string): Promise<string[]>;
  replacePhotos(clinicId: string, urls: string[]): Promise<void>;
}
