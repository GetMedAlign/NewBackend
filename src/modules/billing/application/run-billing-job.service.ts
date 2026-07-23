import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AUDIT, type AuditPort } from '../../auth/domain/ports/audit.port';
import { GenerateInvoicesJob, type JobResult } from './generate-invoices.job';
import { SuspendOverdueAccountsJob } from './suspend-overdue-accounts.job';
import { WeeklySummaryJob } from './weekly-summary.job';

export interface JobAuditActor {
  userId: string | null;
  role: string;
  ip: string | null;
}

type BillingJob = GenerateInvoicesJob | SuspendOverdueAccountsJob | WeeklySummaryJob;

/**
 * Shared job runner (spec §6.1): resolves a `jobName` to one of the three
 * billing jobs, records a `job_triggered` audit row for the given actor,
 * then runs the job and returns its `JobResult`.
 *
 * Used by both the shared-secret cron controller (`BillingJobsController`)
 * and the admin-JWT controller (Task 6) — the caller supplies the actor, so
 * the cron passes `{ userId: null, role: 'system' }` while the admin
 * controller passes the authenticated admin's identity.
 */
@Injectable()
export class RunBillingJobService {
  constructor(
    private readonly generateInvoices: GenerateInvoicesJob,
    private readonly suspendOverdueAccounts: SuspendOverdueAccountsJob,
    private readonly weeklySummary: WeeklySummaryJob,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  async run(jobName: string, actor: JobAuditActor): Promise<JobResult> {
    const job = this.resolveJob(jobName);

    await this.audit.record({
      actorUserId: actor.userId,
      actorRole: actor.role,
      ip: actor.ip,
      actionType: 'job_triggered',
      affectedRecord: jobName,
      notes: 'POST job ' + jobName,
    });

    return job.execute();
  }

  private resolveJob(jobName: string): BillingJob {
    if (jobName === 'invoice-generation') return this.generateInvoices;
    if (jobName === 'account-suspension') return this.suspendOverdueAccounts;
    if (jobName === 'weekly-summary') return this.weeklySummary;
    throw new BadRequestException(`Unknown job: ${jobName}`);
  }
}
