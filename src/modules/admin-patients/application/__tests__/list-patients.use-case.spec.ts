import { ListPatientsUseCase } from '../list-patients.use-case';

describe('ListPatientsUseCase', () => {
  const repo = {
    listPatients: jest.fn(),
    getPatient: jest.fn(),
    updatePatient: jest.fn(),
    softDeletePatient: jest.fn(),
  };
  const useCase = new ListPatientsUseCase(repo);
  const ctx = { userId: 'u1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('forwards the admin context unchanged and returns the repository result', async () => {
    const dtos = [{ id: 'p1' }, { id: 'p2' }];
    repo.listPatients.mockResolvedValue(dtos);

    await expect(useCase.execute(ctx)).resolves.toBe(dtos);
    expect(repo.listPatients).toHaveBeenCalledWith(ctx);
  });
});
