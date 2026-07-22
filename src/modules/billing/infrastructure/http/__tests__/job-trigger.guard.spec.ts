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
  it('rejects a same-length but different secret (exercises the constant-time compare, not the length guard)', () => {
    // 'xxxxxxxxxx' is 10 chars, same length as 'the-secret', so the length short-circuit
    // does NOT fire — this proves timingSafeEqual itself returns false and the guard rejects.
    expect(() => guard.canActivate(ctx('xxxxxxxxxx'))).toThrow(UnauthorizedException);
  });
});
