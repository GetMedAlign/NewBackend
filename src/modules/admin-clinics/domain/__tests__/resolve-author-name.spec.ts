import { resolveAuthorName } from '../resolve-author-name';

describe('resolveAuthorName', () => {
  it('returns the given name when present', () => {
    expect(resolveAuthorName('Dana Reed')).toBe('Dana Reed');
  });

  it('falls back to "Admin" when the name is null', () => {
    expect(resolveAuthorName(null)).toBe('Admin');
  });
});
