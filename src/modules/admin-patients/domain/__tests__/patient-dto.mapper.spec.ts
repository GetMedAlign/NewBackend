import { toAdminPatientDto, type AdminPatientRow } from '../patient-dto.mapper';

const row: AdminPatientRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alex Rivera',
  email: 'alex@example.com',
  date_of_birth: new Date('1985-04-12T00:00:00.000Z'),
  zip_code: '90210',
  created_at: new Date('2026-01-05T18:30:00.000Z'),
  last_assessment_at: new Date('2026-02-10T09:00:00.000Z'),
  treatment_category: 'hormone',
  match_count: 3,
  is_deleted: false,
  deleted_at: null,
};

describe('toAdminPatientDto', () => {
  it('prefers the user name', () => {
    expect(toAdminPatientDto({ ...row, name: 'Alex' }).name).toBe('Alex');
  });

  it('falls back to the email when name is null', () => {
    expect(toAdminPatientDto({ ...row, name: null }).name).toBe(row.email);
  });

  it('converts a null zip to an empty string', () => {
    expect(toAdminPatientDto({ ...row, zip_code: null }).zipCode).toBe('');
  });

  it('formats dob, createdAt, lastAssessmentAt and deletedAt as yyyy-MM-dd', () => {
    const dto = toAdminPatientDto({
      ...row,
      deleted_at: new Date('2026-03-01T00:00:00.000Z'),
    });
    expect(dto.dob).toBe('1985-04-12');
    expect(dto.createdAt).toBe('2026-01-05');
    expect(dto.lastAssessmentAt).toBe('2026-02-10');
    expect(dto.deletedAt).toBe('2026-03-01');
  });

  it('emits null dates as null', () => {
    const dto = toAdminPatientDto({
      ...row,
      date_of_birth: null,
      last_assessment_at: null,
      deleted_at: null,
    });
    expect(dto.dob).toBeNull();
    expect(dto.lastAssessmentAt).toBeNull();
    expect(dto.deletedAt).toBeNull();
  });

  it('passes through a null treatmentCategory for a patient with no assessments', () => {
    expect(toAdminPatientDto({ ...row, treatment_category: null }).treatmentCategory).toBeNull();
  });

  it('passes through matchCount and isDeleted unchanged', () => {
    const dto = toAdminPatientDto({ ...row, match_count: 7, is_deleted: true });
    expect(dto.matchCount).toBe(7);
    expect(dto.isDeleted).toBe(true);
  });

  it('carries the id and email straight through', () => {
    const dto = toAdminPatientDto(row);
    expect(dto.id).toBe(row.id);
    expect(dto.email).toBe(row.email);
  });
});
