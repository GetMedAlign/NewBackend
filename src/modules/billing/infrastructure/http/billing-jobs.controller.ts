import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { AUDIT, type AuditPort } from '../../../auth/domain/ports/audit.port';
import { GenerateInvoicesJob } from '../../application/generate-invoices.job';
import { SuspendOverdueAccountsJob } from '../../application/suspend-overdue-accounts.job';
import type { JobResult } from '../../application/generate-invoices.job';
import { JobTriggerGuard } from './job-trigger.guard';

const JOB_SECRET_HEADER = {
  name: 'x-job-secret',
  description: 'Shared secret for the external cron that triggers billing jobs.',
  required: true,
};

/**
 * Lets an external cron trigger the two billing jobs on demand (spec §2).
 * Authenticated by a shared secret (`X-Job-Secret`, see `JobTriggerGuard`)
 * rather than an admin JWT — deliberately least-privilege for a machine
 * caller: instantly rotatable, and a leaked secret only runs two idempotent
 * jobs instead of granting full back-office access. `@Public()` bypasses the
 * global JWT cookie guard; CSRF is excluded for this route in `app.module.ts`.
 */
@ApiTags('Admin — Jobs')
@Controller('admin/jobs')
@Public()
@UseGuards(JobTriggerGuard)
export class BillingJobsController {
  constructor(
    private readonly generateInvoices: GenerateInvoicesJob,
    private readonly suspendOverdueAccounts: SuspendOverdueAccountsJob,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  @Post('run/:jobName')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Trigger a billing job (invoice-generation | account-suspension). ' +
      'Authenticated via the X-Job-Secret header, not a session cookie.',
  })
  @ApiHeader(JOB_SECRET_HEADER)
  async run(@Param('jobName') jobName: string, @Ip() ip: string): Promise<JobResult> {
    const job = this.resolveJob(jobName);

    await this.audit.record({
      actorUserId: null,
      actorRole: 'system',
      ip,
      actionType: 'job_triggered',
      affectedRecord: jobName,
      notes: 'POST /admin/jobs/run/' + jobName,
    });

    return job.execute();
  }

  private resolveJob(jobName: string): GenerateInvoicesJob | SuspendOverdueAccountsJob {
    if (jobName === 'invoice-generation') return this.generateInvoices;
    if (jobName === 'account-suspension') return this.suspendOverdueAccounts;
    throw new BadRequestException(`Unknown job: ${jobName}`);
  }
}
