/**
 * Wraps an already-hashed password string.
 * Does not perform hashing itself — hashing happens in the PasswordHasherPort adapter.
 */
export class HashedPassword {
  private constructor(private readonly hash: string) {}

  static fromHash(hash: string): HashedPassword {
    return new HashedPassword(hash);
  }

  toString(): string {
    return this.hash;
  }
}
