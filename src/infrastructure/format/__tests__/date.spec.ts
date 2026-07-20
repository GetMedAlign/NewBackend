import { formatDateOnly } from '../date';

describe('formatDateOnly', () => {
  it('formats a date as UTC yyyy-MM-dd', () => {
    expect(formatDateOnly(new Date('2026-03-05T23:59:00.000Z'))).toBe('2026-03-05');
  });

  it('uses UTC, not local time, at a day boundary', () => {
    expect(formatDateOnly(new Date('2026-03-05T00:30:00.000Z'))).toBe('2026-03-05');
  });

  it('returns null for null', () => {
    expect(formatDateOnly(null)).toBeNull();
  });
});
