import type { AuditEvent } from './audit.port';

/**
 * Admin-initiated password set (POST /admin/clinics/:id/set-password and
 * POST /admin/patients/:id/set-password) is a human-approved, contract-parity
 * decision with an accepted account-takeover risk (spec §4.4); the
 * admin_set_password audit row written on every success is one of the agreed
 * mitigations. This port exists so the password-hash update and that audit
 * insert commit as a single atomic unit — if the audit write fails, the
 * password change must roll back too, otherwise the mitigation can be
 * silently defeated.
 */
export interface AdminSetPasswordPort {
  setPasswordWithAudit(userId: string, passwordHash: string, auditEvent: AuditEvent): Promise<void>;
}

export const ADMIN_SET_PASSWORD = Symbol('AdminSetPasswordPort');
