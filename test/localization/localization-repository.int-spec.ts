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
    prisma = new PrismaService();
    await prisma.onModuleInit();
    repo = new PrismaLocalizationRepository(prisma);
  });
  afterAll(async () => {
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
