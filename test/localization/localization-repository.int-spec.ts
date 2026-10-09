import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedLocalization } from '../../prisma/seed/localization.seed';
import { PrismaLocalizationRepository } from '../../src/modules/localization/infrastructure/prisma-localization.repository';

describe('PrismaLocalizationRepository', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });
  let prisma: PrismaService;
  let repo: PrismaLocalizationRepository;

  beforeAll(async () => {
    await seedLocalization(seedPrisma);
    await seedPrisma.$executeRawUnsafe(
      `INSERT INTO location (slug, name, state_code, status) VALUES ('zz-hidden-city','ZZ Hidden','FL','hidden') ON CONFLICT (slug) DO UPDATE SET status='hidden'`,
    );
    await seedPrisma.$executeRawUnsafe(
      `INSERT INTO marketing_service (slug, name, description, status) VALUES ('zz-hidden-service','ZZ Hidden Svc','', 'hidden') ON CONFLICT (slug) DO UPDATE SET status='hidden'`,
    );
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaLocalizationRepository(prisma);
  });
  afterAll(async () => {
    await seedPrisma.$executeRawUnsafe(`DELETE FROM location WHERE slug = 'zz-hidden-city'`);
    await seedPrisma.$executeRawUnsafe(
      `DELETE FROM marketing_service WHERE slug = 'zz-hidden-service'`,
    );
    await prisma.onModuleDestroy();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  it('getLocations(false) excludes hidden and returns aliases + nearSlugs', async () => {
    const cities = await repo.getLocations(false);
    const stpete = cities.find((c) => c.slug === 'st-petersburg');
    expect(stpete?.aliases).toContain('stpete');
    expect(stpete?.nearSlugs[0]).toBe('tampa');
    expect(cities.every((c) => c.status !== 'hidden')).toBe(true);
    expect(cities.some((c) => c.slug === 'zz-hidden-city')).toBe(false);
  });

  it('getLocations(true) includes hidden rows', async () => {
    const cities = await repo.getLocations(true);
    expect(cities.some((c) => c.slug === 'zz-hidden-city')).toBe(true);
  });

  it('getLocationBySlug returns null for a hidden city', async () => {
    expect(await repo.getLocationBySlug('zz-hidden-city')).toBeNull();
  });

  it('getServices(false) excludes hidden and getServices(true) includes it', async () => {
    const activeServices = await repo.getServices(false);
    expect(activeServices.some((s) => s.slug === 'zz-hidden-service')).toBe(false);

    const allServices = await repo.getServices(true);
    expect(allServices.some((s) => s.slug === 'zz-hidden-service')).toBe(true);
  });

  it('getServiceBySlug returns null for a hidden service', async () => {
    expect(await repo.getServiceBySlug('zz-hidden-service')).toBeNull();
  });

  it('getServiceCodeMap resolves the hormone mapping', async () => {
    const map = await repo.getServiceCodeMap();
    expect([...map['hormone-optimization']].sort()).toEqual(['bhrt', 'menopause_hrt', 'trt']);
  });

  it('getMinClinics returns the seeded default', async () => {
    expect(await repo.getMinClinics()).toBe(2);
  });

  it('insertNotify stores a row', async () => {
    await repo.insertNotify('test@example.com', 'orlando');
    const rows = await prisma.asSystem(
      (c) =>
        c.$queryRaw<
          { email: string }[]
        >`SELECT email FROM location_notify WHERE email = 'test@example.com'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
