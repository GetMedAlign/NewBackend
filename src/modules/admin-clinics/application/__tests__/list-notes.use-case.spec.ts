import { NotFoundException } from '@nestjs/common';
import { ListNotesUseCase } from '../list-notes.use-case';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

describe('ListNotesUseCase', () => {
  const clinicRepo = {
    listClinics: jest.fn(),
    getClinic: jest.fn(),
    updateClinic: jest.fn(),
    pauseDelivery: jest.fn(),
    clinicExists: jest.fn(),
    listClinicLeads: jest.fn(),
    findClinicUser: jest.fn(),
  };
  const noteRepo = {
    listNotes: jest.fn(),
    addNote: jest.fn(),
    getAuthorName: jest.fn(),
  };
  const useCase = new ListNotesUseCase(clinicRepo, noteRepo);

  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException with "Clinic not found." when clinicExists resolves false', async () => {
    clinicRepo.clinicExists.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Clinic not found.');
    expect(noteRepo.listNotes).not.toHaveBeenCalled();
  });

  it('returns the notes the repository resolves when the clinic exists', async () => {
    clinicRepo.clinicExists.mockResolvedValue(true);
    const notes = [
      { id: 'n1', createdAt: '2026-02-15T10:00:00.000Z', authorName: 'Dana', body: 'hi' },
    ];
    noteRepo.listNotes.mockResolvedValue(notes);

    const result = await useCase.execute(ctx, 'c1');

    expect(noteRepo.listNotes).toHaveBeenCalledWith(ctx, 'c1');
    expect(result).toBe(notes);
  });
});
