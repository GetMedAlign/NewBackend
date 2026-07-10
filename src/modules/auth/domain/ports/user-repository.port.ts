import type { User } from '../entities/user.entity';

export interface UserRepositoryPort {
  create(email: string, passwordHash: string): Promise<string>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  getPrimaryRole(userId: string): Promise<string>;
  recordFailedLogin(id: string): Promise<void>;
  resetFailedLogin(id: string): Promise<void>;
  setRecoveryPhone(userId: string, phone: string): Promise<void>;
  getRecoveryPhone(userId: string): Promise<string | null>;
}

export const USER_REPOSITORY = Symbol('UserRepositoryPort');
