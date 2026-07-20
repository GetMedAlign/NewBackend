/**
 * Resolves the display name stored on an admin note: the admin's own
 * `users.name`, falling back to the literal string `'Admin'` when the user
 * has no name set. Extracted as a pure function so the fallback rule is
 * unit-testable without a database.
 */
export function resolveAuthorName(name: string | null): string {
  return name ?? 'Admin';
}
