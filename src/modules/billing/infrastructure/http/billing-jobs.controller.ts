import { Controller, HttpCode, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { RunBillingJobService } from '../../application/run-billing-job.service';
import type { JobResult } from '../../application/generate-invoices.job';
import { JobTriggerGuard } from './job-trigger.guard';

const JOB_SECRET_HEADER = {
  name: 'x-job-secret',
  description: 'Shared secret for the external cron that triggers billing jobs.',
  required: true,
};

/**
 * Lets an external cron trigger the three billing jobs on demand (spec §2).
 * Authenticated by a shared secret (`X-Job-Secret`, see `JobTriggerGuard`)
 * rather than an admin JWT: deliberately least-privilege for a machine
 * caller, since it is instantly rotatable, and a leaked secret only runs
 * three idempotent jobs instead of granting full back-office access.
 * `@Public()` bypasses the global JWT cookie guard; CSRF is excluded for
 * this route in `app.module.ts`. Actual resolution/audit/execution lives in
 * `RunBillingJobService`, shared with the admin-JWT controller (Task 6).
 */
@ApiTags('Admin — Jobs')
@Controller('admin/jobs')
@Public()
@UseGuards(JobTriggerGuard)
export class BillingJobsController {
  constructor(private readonly runner: RunBillingJobService) {}

  @Post('run/:jobName')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Trigger a billing job (invoice-generation | account-suspension | weekly-summary). ' +
      'Authenticated via the X-Job-Secret header, not a session cookie.',
  })
  @ApiHeader(JOB_SECRET_HEADER)
  async run(@Param('jobName') jobName: string, @Ip() ip: string): Promise<JobResult> {
    return this.runner.run(jobName, { userId: null, role: 'system', ip });
  }
}
