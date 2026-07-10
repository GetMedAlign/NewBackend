import { Argon2PasswordHasher } from './argon2-password-hasher';

describe('Argon2PasswordHasher', () => {
  let hasher: Argon2PasswordHasher;

  beforeEach(() => {
    hasher = new Argon2PasswordHasher();
  });

  it('produces a hash string for a password', async () => {
    const hash = await hasher.hash('my-password');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('verify returns true for the correct password', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hasher.hash(password);
    const result = await hasher.verify(password, hash);
    expect(result).toBe(true);
  });

  it('verify returns false for an incorrect password', async () => {
    const hash = await hasher.hash('correct-password');
    const result = await hasher.verify('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('two hashes of the same password differ (salt randomness)', async () => {
    const password = 'same-password';
    const hash1 = await hasher.hash(password);
    const hash2 = await hasher.hash(password);
    expect(hash1).not.toBe(hash2);
  });
});
