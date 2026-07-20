import { ListClinicsUseCase } from '../list-clinics.use-case';

describe('ListClinicsUseCase', () => {
  const repo = { listClinics: jest.fn(), getClinic: jest.fn() };
  const useCase = new ListClinicsUseCase(repo);
  const ctx = { userId: 'u1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('forwards the admin context unchanged and returns the repository result', async () => {
    const dtos = [{ id: 'c1' }, { id: 'c2' }];
    repo.listClinics.mockResolvedValue(dtos);

    await expect(useCase.execute(ctx)).resolves.toBe(dtos);
    expect(repo.listClinics).toHaveBeenCalledWith(ctx);
  });
});
