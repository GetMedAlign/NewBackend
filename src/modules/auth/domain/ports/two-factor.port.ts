export interface TwoFactorPort {
  issueCode(userId: string): Promise<void>;
  verifyCode(userId: string, code: string): Promise<boolean>;
}

export const TWO_FACTOR = Symbol('TwoFactorPort');
