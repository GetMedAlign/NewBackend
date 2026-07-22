import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { Env } from '../../../../infrastructure/config/env.schema';

/**
 * Guards `POST /admin/jobs/run/:jobName` (spec §2) with a shared secret
 * instead of an admin JWT: this endpoint is meant for a machine caller (an
 * external cron), so least-privilege calls for a secret that is scoped to
 * exactly this route, instantly rotatable, and — if leaked — only runs the
 * two idempotent billing jobs rather than granting full back-office access.
 *
 * The secret is compared in constant time via `timingSafeEqual`. Unequal
 * lengths are rejected WITHOUT calling `timingSafeEqual` (it throws on
 * mismatched-length buffers).
 */
@Injectable()
export class JobTriggerGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-job-secret'];
    const provided = Array.isArray(header) ? header[0] : header;
    const expected = this.config.getOrThrow('JOB_TRIGGER_SECRET', { infer: true });
    if (typeof provided !== 'string') throw new UnauthorizedException('Invalid job secret');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid job secret');
    }
    return true;
  }
}
