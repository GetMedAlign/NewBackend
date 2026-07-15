/**
 * Produces a URL-safe slug from an arbitrary clinic name:
 * lowercased, non-alphanumeric runs collapsed to a single '-', with leading and
 * trailing '-' trimmed. Used to derive a clinic's `slug` on approval.
 */
export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Appends a short collision suffix to a base slug so a duplicate name still
 * yields a unique slug. The suffix is 8 hex chars derived from the caller.
 */
export function withSlugSuffix(baseSlug: string, suffix: string): string {
  const shortSuffix = suffix
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 8)
    .toLowerCase();
  return `${baseSlug}-${shortSuffix}`;
}
