import { SuspendOverdueAccountsJob } from '../suspend-overdue-accounts.job';
import type {
  BillingRepositoryPort,
  OverdueClinic,
} from '../../domain/ports/billing-repository.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

function makeRepo(
  overrides: Partial<BillingRepositoryPort> = {},
): jest.Mocked<
  Pick<BillingRepositoryPort, 'listSuspendableClinics' | 'suspendClinicForNonPayment'>
> {
  return {
    listSuspendableClinics: jest.fn().mockResolvedValue([]),
    suspendClinicForNonPayment: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<
    Pick<BillingRepositoryPort, 'listSuspendableClinics' | 'suspendClinicForNonPayment'>
  >;
}

function makeEmail(send: jest.Mock = jest.fn().mockResolvedValue(undefined)): EmailSenderPort {
  return { send };
}

const overdueClinic: OverdueClinic = {
  clinicId: 'c1',
  clinicName: 'Vitality',
  billingEmail: 'b@c.test',
  overdueTotal: 250.5,
  overdueDueDate: new Date('2025-04-01T00:00:00Z'),
};

describe('SuspendOverdueAccountsJob', () => {
  it('suspends each returned clinic and sends a best-effort overdue-warning email', async () => {
    const repo = makeRepo({
      listSuspendableClinics: jest.fn().mockResolvedValue([overdueClinic]),
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(send),
    );

    const now = new Date('2025-05-05T00:00:00Z');
    const r = await job.execute(now);

    expect(repo.listSuspendableClinics).toHaveBeenCalledWith(now);
    expect(repo.suspendClinicForNonPayment).toHaveBeenCalledWith('c1');
    expect(send).toHaveBeenCalledWith('b@c.test', expect.any(String), expect.any(String));
    expect(r).toMatchObject({ job: 'account-suspension', processed: 1, skipped: 0, failed: 0 });
  });

  it('counts a clinic whose suspension write throws as failed, without stopping the others', async () => {
    const clinicOk: OverdueClinic = { ...overdueClinic, clinicId: 'c-ok' };
    const clinicBad: OverdueClinic = { ...overdueClinic, clinicId: 'c-bad' };
    const repo = makeRepo({
      listSuspendableClinics: jest.fn().mockResolvedValue([clinicBad, clinicOk]),
      suspendClinicForNonPayment: jest.fn().mockImplementation((clinicId: string) => {
        if (clinicId === 'c-bad') throw new Error('db is down');
        return Promise.resolve(undefined);
      }),
    });
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toMatchObject({ job: 'account-suspension', processed: 1, skipped: 0, failed: 1 });
  });

  it('does not fail the clinic when the best-effort overdue-warning email throws', async () => {
    const repo = makeRepo({
      listSuspendableClinics: jest.fn().mockResolvedValue([overdueClinic]),
    });
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(send),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toMatchObject({ job: 'account-suspension', processed: 1, skipped: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.suspendClinicForNonPayment).toHaveBeenCalledWith('c1');
  });

  it('skips the email when the clinic has no billing email', async () => {
    const repo = makeRepo({
      listSuspendableClinics: jest
        .fn()
        .mockResolvedValue([{ ...overdueClinic, billingEmail: null }]),
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(send),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ job: 'account-suspension', processed: 1, skipped: 0, failed: 0 });
  });

  it('returns all zeros when there are no suspendable clinics', async () => {
    const repo = makeRepo();
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(),
    );

    const r = await job.execute(new Date('2025-05-05T00:00:00Z'));

    expect(r).toEqual({ job: 'account-suspension', processed: 0, skipped: 0, failed: 0 });
  });

  it('defaults now to the current date when not passed', async () => {
    const repo = makeRepo();
    const job = new SuspendOverdueAccountsJob(
      repo as unknown as BillingRepositoryPort,
      makeEmail(),
    );

    await job.execute();

    expect(repo.listSuspendableClinics).toHaveBeenCalledWith(expect.any(Date));
  });
});
