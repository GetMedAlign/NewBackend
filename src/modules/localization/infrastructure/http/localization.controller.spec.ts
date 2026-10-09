import { LocalizationController } from './localization.controller';

describe('LocalizationController', () => {
  const cities = { execute: jest.fn().mockResolvedValue({ cities: [] }) };
  const city = { execute: jest.fn().mockResolvedValue({ slug: 'tampa' }) };
  const services = { execute: jest.fn() };
  const service = { execute: jest.fn() };
  const combo = { execute: jest.fn() };
  const coverage = { execute: jest.fn() };
  const notify = { execute: jest.fn().mockResolvedValue({ ok: true }) };

  const controller = new LocalizationController(
    cities as never,
    city as never,
    services as never,
    service as never,
    combo as never,
    coverage as never,
    notify as never,
  );

  it('delegates cityDetail to the use-case', async () => {
    await controller.cityDetail('tampa');
    expect(city.execute).toHaveBeenCalledWith('tampa');
  });

  it('maps notify dto to the use-case input', async () => {
    const result = await controller.notify({ email: 'a@b.com', citySlug: 'orlando' });
    expect(notify.execute).toHaveBeenCalledWith({ email: 'a@b.com', citySlug: 'orlando' });
    expect(result).toEqual({ ok: true });
  });

  it('passes null citySlug when omitted', async () => {
    await controller.notify({ email: 'a@b.com' });
    expect(notify.execute).toHaveBeenCalledWith({ email: 'a@b.com', citySlug: null });
  });
});
