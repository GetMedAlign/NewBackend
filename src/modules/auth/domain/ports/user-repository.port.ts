import type { User } from '../entities/user.entity';

export interface UserRepositoryPort {
  create(email: string, passwordHash: string, name?: string, dob?: string): Promise<string>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  setEmailConfirmed(email: string): Promise<void>;
  getPrimaryRole(userId: string): Promise<string>;
  getClinicId(userId: string): Promise<string | null>;
  recordFailedLogin(id: string): Promise<void>;
  resetFailedLogin(id: string): Promise<void>;
  setRecoveryPhone(userId: string, phone: string): Promise<void>;
  getRecoveryPhone(userId: string): Promise<string | null>;
}

export const USER_REPOSITORY = Symbol('UserRepositoryPort');
