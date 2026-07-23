import { WeeklySummaryJob } from '../weekly-summary.job';
import type {
  BillingRepositoryPort,
  WeeklySummaryClinic,
} from '../../domain/ports/billing-repository.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

function makeRepo(
  overrides: Partial<BillingRepositoryPort> = {},
): jest.Mocked<
  Pick<BillingRepositoryPort, 'listWeeklySummaryClinics' | 'countLeadsSince' | 'countAllLeads'>
> {
  return {
    listWeeklySummaryClinics: jest.fn().mockResolvedValue([]),
    countLeadsSince: jest.fn().mockResolvedValue(0),
    countAllLeads: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as jest.Mocked<
    Pick<BillingRepositoryPort, 'listWeeklySummaryClinics' | 'countLeadsSince' | 'countAllLeads'>
  >;
}

function makeEmail(send: jest.Mock = jest.fn().mockResolvedValue(undefined)): EmailSenderPort {
  return { send };
}

const clinic: WeeklySummaryClinic = {
  clinicId: 'c1',
  clinicName: 'Vitality',
  businessEmail: 'biz@c.test',
};

describe('WeeklySummaryJob', () => {
  it('emails each opted-in clinic its weekly and total lead counts', async () => {
    const repo = makeRepo({
      listWeeklySummaryClinics: jest.fn().mockResolvedValue([clinic]),
      countLeadsSince: jest.fn().mockResolvedValue(3),
      countAllLeads: jest.fn().mockResolvedValue(20),
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const job = new WeeklySummaryJob(repo as unknown as BillingRepositoryPort, makeEmail(send));

    const now = new Date('2026-07-20T00:00:00Z');
    const r = await job.execute(now);

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(repo.listWeeklySummaryClinics).toHaveBeenCalledWith();
    expect(repo.countLeadsSince).toHaveBeenCalledWith('c1', weekAgo);
    expect(repo.countAllLeads).toHaveBeenCalledWith('c1');
    expect(send).toHaveBeenCalledWith(
      'biz@c.test',
      expect.any(String),
      expect.stringContaining('3'),
    );
    expect(r).toMatchObject({ job: 'weekly-summary', processed: 1, skipped: 0, failed: 0 });
  });

  it('skips a clinic with no business email, without sending an email or failing it', async () => {
    const repo = makeRepo({
      listWeeklySummaryClinics: jest
        .fn()
        .mockResolvedValue([{ clinicId: 'c1', clinicName: 'V', businessEmail: null }]),
      countLeadsSince: jest.fn().mockResolvedValue(0),
      countAllLeads: jest.fn().mockResolvedValue(0),
    });
    const send = jest.fn().mockResolvedValue(undefined);
    const job = new WeeklySummaryJob(repo as unknown as BillingRepositoryPort, makeEmail(send));

    const r = await job.execute(new Date('2026-07-20T00:00:00Z'));

    expect(send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ job: 'weekly-summary', processed: 0, skipped: 1, failed: 0 });
  });

  it('counts a clinic whose email throws as failed without stopping the batch', async () => {
    const repo = makeRepo({
      listWeeklySummaryClinics: jest.fn().mockResolvedValue([
        { clinicId: 'c1', clinicName: 'A', businessEmail: 'a@c.test' },
        { clinicId: 'c2', clinicName: 'B', businessEmail: 'b@c.test' },
      ]),
      countLeadsSince: jest.fn().mockResolvedValue(1),
      countAllLeads: jest.fn().mockResolvedValue(1),
    });
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(undefined);
    const job = new WeeklySummaryJob(repo as unknown as BillingRepositoryPort, makeEmail(send));

    const r = await job.execute(new Date('2026-07-20T00:00:00Z'));

    expect(r.failed).toBe(1);
    expect(r.processed).toBe(1);
    expect(r).toMatchObject({ job: 'weekly-summary', skipped: 0 });
    expect(r.details).toBeDefined();
    expect(r.details![0]).toContain('c1');
  });

  it('returns all zeros with no details when there are no opted-in clinics', async () => {
    const repo = makeRepo();
    const job = new WeeklySummaryJob(repo as unknown as BillingRepositoryPort, makeEmail());

    const r = await job.execute(new Date('2026-07-20T00:00:00Z'));

    expect(r).toEqual({ job: 'weekly-summary', processed: 0, skipped: 0, failed: 0 });
  });

  it('defaults now to the current date when not passed', async () => {
    const repo = makeRepo();
    const job = new WeeklySummaryJob(repo as unknown as BillingRepositoryPort, makeEmail());

    await job.execute();

    expect(repo.listWeeklySummaryClinics).toHaveBeenCalled();
  });
});
