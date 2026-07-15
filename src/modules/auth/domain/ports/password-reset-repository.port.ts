export interface PasswordResetRepositoryPort {
  findUserIdByEmail(email: string): Promise<string | null>;
  issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findValidByEmail(
    email: string,
    tokenHash: string,
  ): Promise<{ id: string; userId: string } | null>;
  consume(id: string): Promise<void>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
}

export const PASSWORD_RESET_REPOSITORY = Symbol('PasswordResetRepositoryPort');
