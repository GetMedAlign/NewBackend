import { toSlug, withSlugSuffix } from '../slug';

describe('toSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(toSlug('Horizon Hormone Health')).toBe('horizon-hormone-health');
  });

  it('collapses runs of non-alphanumeric characters to a single hyphen', () => {
    expect(toSlug('Foo   &&&  Bar!!!')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(toSlug('  --Foo Bar-- ')).toBe('foo-bar');
  });

  it('keeps digits', () => {
    expect(toSlug('Clinic 24/7')).toBe('clinic-24-7');
  });

  it('handles a name that is entirely punctuation', () => {
    expect(toSlug('!!!')).toBe('');
  });
});

describe('withSlugSuffix', () => {
  it('appends a short hex suffix to the base slug', () => {
    expect(withSlugSuffix('horizon-hormone-health', 'abcdef1234567890')).toBe(
      'horizon-hormone-health-abcdef12',
    );
  });

  it('strips non-alphanumeric characters and truncates to 8 chars', () => {
    expect(withSlugSuffix('foo', 'a1b2-c3d4-e5f6')).toBe('foo-a1b2c3d4');
  });
});
