import { BadRequestException } from '@nestjs/common';
import { RunBillingJobService, type JobAuditActor } from '../run-billing-job.service';
import { GenerateInvoicesJob } from '../generate-invoices.job';
import { SuspendOverdueAccountsJob } from '../suspend-overdue-accounts.job';
import { WeeklySummaryJob } from '../weekly-summary.job';
import type { AuditPort } from '../../../auth/domain/ports/audit.port';

function makeJobMock<T extends { execute: (...args: never[]) => unknown }>(): jest.Mocked<
  Pick<T, 'execute'>
> {
  return { execute: jest.fn() } as unknown as jest.Mocked<Pick<T, 'execute'>>;
}

describe('RunBillingJobService', () => {
  let invoiceJob: jest.Mocked<Pick<GenerateInvoicesJob, 'execute'>>;
  let suspendJob: jest.Mocked<Pick<SuspendOverdueAccountsJob, 'execute'>>;
  let weeklyJob: jest.Mocked<Pick<WeeklySummaryJob, 'execute'>>;
  let audit: jest.Mocked<AuditPort>;
  let service: RunBillingJobService;
  const actor: JobAuditActor = { userId: null, role: 'system', ip: '1.2.3.4' };

  beforeEach(() => {
    invoiceJob = makeJobMock<GenerateInvoicesJob>();
    suspendJob = makeJobMock<SuspendOverdueAccountsJob>();
    weeklyJob = makeJobMock<WeeklySummaryJob>();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new RunBillingJobService(
      invoiceJob as unknown as GenerateInvoicesJob,
      suspendJob as unknown as SuspendOverdueAccountsJob,
      weeklyJob as unknown as WeeklySummaryJob,
      audit,
    );
  });

  it('resolves and runs invoice-generation with an audit row', async () => {
    invoiceJob.execute.mockResolvedValue({
      job: 'invoice-generation',
      processed: 1,
      skipped: 0,
      failed: 0,
    });
    const r = await service.run('invoice-generation', {
      userId: null,
      role: 'system',
      ip: '1.2.3.4',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        actorRole: 'system',
        ip: '1.2.3.4',
        actionType: 'job_triggered',
        affectedRecord: 'invoice-generation',
      }),
    );
    expect(r.job).toBe('invoice-generation');
  });

  it('runs account-suspension and weekly-summary', async () => {
    suspendJob.execute.mockResolvedValue({
      job: 'account-suspension',
      processed: 0,
      skipped: 0,
      failed: 0,
    });
    weeklyJob.execute.mockResolvedValue({
      job: 'weekly-summary',
      processed: 0,
      skipped: 0,
      failed: 0,
    });
    expect((await service.run('account-suspension', actor)).job).toBe('account-suspension');
    expect((await service.run('weekly-summary', actor)).job).toBe('weekly-summary');
  });

  it('records the audit with the given actor (admin case)', async () => {
    weeklyJob.execute.mockResolvedValue({
      job: 'weekly-summary',
      processed: 0,
      skipped: 0,
      failed: 0,
    });
    await service.run('weekly-summary', { userId: 'admin-1', role: 'admin', ip: '9.9.9.9' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'admin-1', actorRole: 'admin' }),
    );
  });

  it('throws 400 for an unknown job name', async () => {
    await expect(service.run('nope', actor)).rejects.toThrow(BadRequestException);
  });
});
