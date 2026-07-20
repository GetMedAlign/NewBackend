import { of, throwError, lastValueFrom } from 'rxjs';
import { PhiAccessInterceptor } from '../phi-access.interceptor';

function ctxFor(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe('PhiAccessInterceptor', () => {
  const audit = { record: jest.fn() };
  const interceptor = new PhiAccessInterceptor(audit);
  const next = { handle: () => of('payload') };

  beforeEach(() => jest.resetAllMocks());

  it('records a phi_access entry with the actor, ip, and resource id', async () => {
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients/p1',
      params: { id: 'p1' },
    };
    await lastValueFrom(interceptor.intercept(ctxFor(req), next));
    expect(audit.record).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      actorRole: 'admin',
      ip: '10.0.0.4',
      actionType: 'phi_access',
      affectedRecord: 'p1',
      notes: 'GET /admin/patients/p1',
    });
  });

  it('records a null affectedRecord on the list route', async () => {
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await lastValueFrom(interceptor.intercept(ctxFor(req), next));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ affectedRecord: null }));
  });

  it('still returns the response when the audit write fails', async () => {
    audit.record.mockRejectedValue(new Error('audit down'));
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await expect(lastValueFrom(interceptor.intercept(ctxFor(req), next))).resolves.toBe('payload');
  });

  it('propagates a handler error and does not swallow it, after still recording the audit event', async () => {
    audit.record.mockResolvedValue(undefined);
    const throwingNext = { handle: () => throwError(() => new Error('handler exploded')) };
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await expect(lastValueFrom(interceptor.intercept(ctxFor(req), throwingNext))).rejects.toThrow(
      'handler exploded',
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('still returns the response when the audit write rejects with a non-Error string', async () => {
    audit.record.mockRejectedValue('audit down');
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await expect(lastValueFrom(interceptor.intercept(ctxFor(req), next))).resolves.toBe('payload');
  });

  it('still returns the response when the audit write rejects with null', async () => {
    audit.record.mockRejectedValue(null);
    const req = {
      user: { sub: 'admin-1', role: 'admin' },
      ip: '10.0.0.4',
      method: 'GET',
      path: '/admin/patients',
      params: {},
    };
    await expect(lastValueFrom(interceptor.intercept(ctxFor(req), next))).resolves.toBe('payload');
  });
});
