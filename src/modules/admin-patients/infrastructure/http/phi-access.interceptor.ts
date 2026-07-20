import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Inject,
} from '@nestjs/common';
import { Observable, defer, switchMap, catchError, of } from 'rxjs';
import { AuditPort, AUDIT } from '../../../auth/domain/ports/audit.port';

@Injectable()
export class PhiAccessInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PhiAccessInterceptor.name);

  constructor(@Inject(AUDIT) private readonly audit: AuditPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest() as {
      user: { sub: string; role: string };
      ip: string;
      method: string;
      path: string;
      params: Record<string, unknown>;
    };

    const event = {
      actorUserId: req.user.sub,
      actorRole: req.user.role,
      ip: req.ip,
      actionType: 'phi_access' as const,
      affectedRecord: (req.params.id ?? null) as string | null,
      notes: `${req.method} ${req.path}`,
    };

    // Record the audit event before delegating to next.handle()
    // catchError swallows the error so the request still succeeds
    return defer(() => Promise.resolve(this.audit.record(event))).pipe(
      catchError((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(`Failed to record PHI access: ${message}`, stack);
        return of(undefined); // Swallow the error
      }),
      switchMap(() => next.handle()),
    );
  }
}
