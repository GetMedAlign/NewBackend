export interface PasswordHasherPort {
  hash(pw: string): Promise<string>;
  verify(pw: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PasswordHasherPort');
