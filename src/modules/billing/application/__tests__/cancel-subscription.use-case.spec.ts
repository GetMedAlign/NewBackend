import { ConflictException } from '@nestjs/common';
import { CancelSubscriptionUseCase } from '../cancel-subscription.use-case';

describe('CancelSubscriptionUseCase', () => {
  const repo = { cancelSubscription: jest.fn() };
  const useCase = new CancelSubscriptionUseCase(repo);
  beforeEach(() => jest.resetAllMocks());

  it('throws 409 when already cancelled', async () => {
    repo.cancelSubscription.mockResolvedValue('already_cancelled');
    await expect(
      useCase.execute({ clinicId: 'c1' }, new Date('2026-07-22T12:00:00Z')),
    ).rejects.toThrow('Subscription is already cancelled.');
    await expect(
      useCase.execute({ clinicId: 'c1' }, new Date('2026-07-22T12:00:00Z')),
    ).rejects.toThrow(ConflictException);
  });

  it('returns cancelledAt and activeThrough (end of month) on success', async () => {
    repo.cancelSubscription.mockResolvedValue('ok');
    const r = await useCase.execute({ clinicId: 'c1' }, new Date('2026-07-22T12:00:00Z'));
    expect(r.cancelledAt).toBe('2026-07-22T12:00:00.000Z');
    expect(r.activeThrough).toBe('2026-07-31T23:59:59.000Z');
    expect(repo.cancelSubscription).toHaveBeenCalledWith(
      { clinicId: 'c1' },
      new Date('2026-07-22T12:00:00Z'),
      new Date('2026-07-31T23:59:59.000Z'),
    );
  });
});
