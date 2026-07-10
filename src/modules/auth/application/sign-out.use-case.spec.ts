import { SignOutUseCase } from './sign-out.use-case';

describe('SignOutUseCase', () => {
  let useCase: SignOutUseCase;

  beforeEach(() => {
    useCase = new SignOutUseCase();
  });

  it('returns { ok: true } with a userId', async () => {
    const result = await useCase.execute({ userId: 'user-id' });

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } without a userId (no session state to clear)', async () => {
    const result = await useCase.execute({});

    expect(result).toEqual({ ok: true });
  });
});
