export interface EncryptionPort {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export const ENCRYPTION_PORT = Symbol('EncryptionPort');
