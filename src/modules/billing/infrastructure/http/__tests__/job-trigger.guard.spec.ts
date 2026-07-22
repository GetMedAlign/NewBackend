import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JobTriggerGuard } from '../job-trigger.guard';

function ctx(headerValue: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-job-secret': headerValue } }) }),
  } as unknown as ExecutionContext;
}
const config = { getOrThrow: () => 'the-secret' } as never;

describe('JobTriggerGuard', () => {
  const guard = new JobTriggerGuard(config);
  it('allows a matching secret', () => {
    expect(guard.canActivate(ctx('the-secret'))).toBe(true);
  });
  it('rejects a wrong secret', () => {
    expect(() => guard.canActivate(ctx('nope'))).toThrow(UnauthorizedException);
  });
  it('rejects a missing header', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });
});
