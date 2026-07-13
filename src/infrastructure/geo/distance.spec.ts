import { distanceMiles } from './distance';

describe('distanceMiles', () => {
  it('returns 0 for identical points', () => {
    expect(distanceMiles(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('returns approximately 2445 miles between NYC and LA', () => {
    // NYC: 40.7128, -74.0060  LA: 34.0522, -118.2437
    const d = distanceMiles(40.7128, -74.006, 34.0522, -118.2437);
    expect(d).toBeGreaterThan(2430);
    expect(d).toBeLessThan(2460);
  });

  it('returns a short plausible distance between nearby cities (NYC to Philadelphia ~95 miles)', () => {
    // Philadelphia: 39.9526, -75.1652
    const d = distanceMiles(40.7128, -74.006, 39.9526, -75.1652);
    expect(d).toBeGreaterThan(80);
    expect(d).toBeLessThan(110);
  });

  it('is symmetric', () => {
    const a = distanceMiles(40.7128, -74.006, 34.0522, -118.2437);
    const b = distanceMiles(34.0522, -118.2437, 40.7128, -74.006);
    expect(Math.abs(a - b)).toBeLessThan(0.0001);
  });
});
