import { NotFoundException } from '@nestjs/common';
import { ListClinicLeadsUseCase } from '../list-clinic-leads.use-case';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

// A row using the exact mixed-case shape of AdminLeadRow. Kept inline (not
// typed against the interface) so a future accidental rename of the
// interface doesn't silently "fix" this test too — the assertions below
// check exact string keys.
const leadRow = {
  lead_id: 'lead-1',
  received_at: '2026-02-15T10:00:00.000Z',
  patientFirstName: 'Pat',
  patientEmail: 'pat@example.com',
  patientZip: '',
  treatmentCategory: 'hormone',
  delivery_status: 'delivered',
  clinic_status: 'new',
};

describe('ListClinicLeadsUseCase', () => {
  const repo = {
    listClinics: jest.fn(),
    getClinic: jest.fn(),
    updateClinic: jest.fn(),
    pauseDelivery: jest.fn(),
    clinicExists: jest.fn(),
    listClinicLeads: jest.fn(),
    findClinicUser: jest.fn(),
  };
  const useCase = new ListClinicLeadsUseCase(repo);

  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException with "Clinic not found." when clinicExists resolves false', async () => {
    repo.clinicExists.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Clinic not found.');
    expect(repo.listClinicLeads).not.toHaveBeenCalled();
  });

  it('returns the mixed-case lead rows untouched when the clinic exists', async () => {
    repo.clinicExists.mockResolvedValue(true);
    repo.listClinicLeads.mockResolvedValue([leadRow]);

    const result = await useCase.execute(ctx, 'c1');

    expect(repo.listClinicLeads).toHaveBeenCalledWith(ctx, 'c1');
    expect(result).toEqual([leadRow]);
    // The keys the use case hands back must be exactly the mixed-case set —
    // no normalization, no dropped/added keys.
    expect(Object.keys(result[0]!).sort()).toEqual(
      [
        'lead_id',
        'received_at',
        'patientFirstName',
        'patientEmail',
        'patientZip',
        'treatmentCategory',
        'delivery_status',
        'clinic_status',
      ].sort(),
    );
  });
});
