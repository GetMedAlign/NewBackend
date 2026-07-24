import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';

/** The only two roles that make someone a "team member" on the Team page. */
export type AdminRole = 'admin' | 'superadmin';

/** A single row of the team list / the shape returned after create. */
export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  /** ISO 8601 string, already formatted by the repository. */
  createdAt: string;
}

export interface CreateAdminInput {
  name: string;
  email: string;
  /** Already hashed by PASSWORD_HASHER before it reaches the repository. */
  passwordHash: string;
  role: AdminRole;
}

export interface AdminTeamRepositoryPort {
  /** All users whose role is 'admin' or 'superadmin', ordered by created_at. */
  listAdmins(ctx: AdminCtx): Promise<AdminUserRow[]>;

  /**
   * Creates a new admin/superadmin user (email_confirmed = true, no
   * self-signup flow). Throws EmailAlreadyExistsError when the email is
   * already registered by any user.
   */
  createAdmin(ctx: AdminCtx, input: CreateAdminInput): Promise<AdminUserRow>;

  /**
   * Hard-deletes a user, scoped to rows that currently have an 'admin' or
   * 'superadmin' role (so this endpoint can never be used to delete a
   * patient or clinic user). Returns false when no such row exists.
   */
  deleteAdmin(ctx: AdminCtx, id: string): Promise<boolean>;

  /**
   * Sets the password hash for a user scoped to an 'admin'/'superadmin' role.
   * Returns false when no such row exists.
   */
  setAdminPassword(ctx: AdminCtx, id: string, passwordHash: string): Promise<boolean>;
}

export const ADMIN_TEAM_REPOSITORY = Symbol('AdminTeamRepositoryPort');
