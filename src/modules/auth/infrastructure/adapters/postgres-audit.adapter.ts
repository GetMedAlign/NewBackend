import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { AuditPort, AuditEvent } from '../../domain/ports/audit.port';

@Injectable()
export class PostgresAuditAdapter implements AuditPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(e: AuditEvent): Promise<void> {
    await this.prisma.asSystem(
      (client) =>
        client.$executeRaw`
        SELECT append_audit_log(
          ${e.actorUserId ?? null}::uuid,
          ${e.actorRole},
          ${e.ip ?? null},
          ${e.actionType},
          ${e.affectedRecord ?? ''},
          NULL::jsonb,
          NULL::jsonb,
          ${e.notes ?? null}
        )
      `,
    );
  }
}
