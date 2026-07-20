import { NotFoundException } from '@nestjs/common';
import { AddNoteUseCase } from '../add-note.use-case';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

describe('AddNoteUseCase', () => {
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
  const useCase = new AddNoteUseCase(clinicRepo, noteRepo);

  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException with "Clinic not found." when clinicExists resolves false', async () => {
    clinicRepo.clinicExists.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'missing', 'note body')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing', 'note body')).rejects.toThrow('Clinic not found.');
    expect(noteRepo.addNote).not.toHaveBeenCalled();
  });

  it('delegates to the repository with exactly ctx, clinicId, and body — never an authorName from the caller', async () => {
    clinicRepo.clinicExists.mockResolvedValue(true);
    noteRepo.getAuthorName.mockResolvedValue('Dana Reed');
    const created = {
      id: 'n1',
      createdAt: '2026-02-15T10:00:00.000Z',
      authorName: 'Dana Reed',
      body: 'note body',
    };
    noteRepo.addNote.mockResolvedValue(created);

    const result = await useCase.execute(ctx, 'c1', 'note body');

    expect(noteRepo.addNote).toHaveBeenCalledWith(ctx, 'c1', 'note body');
    expect(result).toBe(created);
  });

  it('returns whatever the repository resolves, including an "Admin" fallback authorName', async () => {
    clinicRepo.clinicExists.mockResolvedValue(true);
    noteRepo.getAuthorName.mockResolvedValue(null);
    const created = {
      id: 'n2',
      createdAt: '2026-02-15T10:00:00.000Z',
      authorName: 'Admin',
      body: 'note body',
    };
    noteRepo.addNote.mockResolvedValue(created);

    const result = await useCase.execute(ctx, 'c1', 'note body');

    expect(noteRepo.addNote).toHaveBeenCalledWith(ctx, 'c1', 'note body');
    expect(result.authorName).toBe('Admin');
  });
});
