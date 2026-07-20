import {
  isClinicStatus,
  toAdminClinicDto,
  type AdminClinicRow,
  type ClinicServiceRow,
} from '../clinic-dto.mapper';

const baseRow: AdminClinicRow = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'vitality-hormone-nyc',
  name: 'Vitality Hormone NYC',
  location: 'New York, NY',
  city: 'New York',
  state_code: 'NY',
  zip_code: '10001',
  rating: 4.5,
  review_count: 120,
  about: null,
  differentiators: null,
  new_patient_wait: '1-2 weeks',
  telehealth_available: true,
  offers_lab_work: false,
  website_url: null,
  consultation_fee_band: '$$',
  monthly_program_band: '$$$',
  financing_available: true,
  accepts_insurance: false,
  insurance_notes: null,
  provider_name: null,
  credentials: null,
  photo_count: 3,
  status: 'active',
  created_at: new Date('2026-03-05T18:30:00.000Z'),
  billing_status: 'current',
  webhook_health: 'unknown',
  suspension_reason: null,
};

describe('isClinicStatus', () => {
  it.each(['active', 'paused', 'suspended', 'inactive'])('accepts %s', (s) => {
    expect(isClinicStatus(s)).toBe(true);
  });

  it.each(['Active', 'deleted', '', 'ACTIVE'])('rejects %s', (s) => {
    expect(isClinicStatus(s)).toBe(false);
  });
});

describe('toAdminClinicDto', () => {
  it('falls back to the wellness category when the clinic has none', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.category).toBe('wellness');
    expect(dto.specialty).toBe('Integrative Wellness');
  });

  it('maps a known category to its specialty label', () => {
    const dto = toAdminClinicDto(baseRow, ['med_spa'], [], 0, null);
    expect(dto.category).toBe('med_spa');
    expect(dto.specialty).toBe('Med Spa & Aesthetics');
  });

  it('falls back to the category code when it is not in the specialty map', () => {
    const dto = toAdminClinicDto(baseRow, ['cryotherapy'], [], 0, null);
    expect(dto.specialty).toBe('cryotherapy');
  });

  it('uses the first category when several exist', () => {
    const dto = toAdminClinicDto(baseRow, ['peptide', 'hormone'], [], 0, null);
    expect(dto.category).toBe('peptide');
  });

  it('splits top services from all services and orders each', () => {
    const services: ClinicServiceRow[] = [
      { service_code: 'z_top', is_top_service: true, display_order: 2 },
      { service_code: 'a_other', is_top_service: false, display_order: 1 },
      { service_code: 'b_top', is_top_service: true, display_order: 1 },
      { service_code: 'c_other', is_top_service: false, display_order: 2 },
    ];
    const dto = toAdminClinicDto(baseRow, [], services, 0, null);
    expect(dto.services).toEqual(['b_top', 'z_top']);
    expect(dto.allServices).toEqual(['b_top', 'z_top', 'a_other', 'c_other']);
  });

  it('converts null text fields to empty strings', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.about).toBe('');
    expect(dto.differentiators).toBe('');
    expect(dto.insuranceNotes).toBe('');
    expect(dto.providerName).toBe('');
    expect(dto.credentials).toBe('');
  });

  it('emits rating as a number', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(typeof dto.rating).toBe('number');
    expect(dto.rating).toBe(4.5);
  });

  it('formats createdAt and lastLeadAt as yyyy-MM-dd', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 7, new Date('2026-06-01T10:00:00.000Z'));
    expect(dto.createdAt).toBe('2026-03-05');
    expect(dto.lastLeadAt).toBe('2026-06-01');
    expect(dto.leadCount).toBe(7);
  });

  it('emits a null lastLeadAt when the clinic has no leads', () => {
    const dto = toAdminClinicDto(baseRow, [], [], 0, null);
    expect(dto.lastLeadAt).toBeNull();
    expect(dto.leadCount).toBe(0);
  });
});
