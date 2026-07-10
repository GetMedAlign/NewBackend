export interface AuditEvent {
  actorUserId: string | null;
  actorRole: string;
  ip: string | null;
  actionType: string;
  affectedRecord?: string | null;
  notes?: string | null;
}

export interface AuditPort {
  record(e: AuditEvent): Promise<void>;
}

export const AUDIT = Symbol('AuditPort');
