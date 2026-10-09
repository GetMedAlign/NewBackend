import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { seedLocalization } from '../../prisma/seed/localization.seed';

describe('seedLocalization', () => {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  beforeAll(async () => {
    await seedLocalization(prisma);
    await seedLocalization(prisma); // idempotent: run twice
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('seeds 9 cities with Naples coming_soon', async () => {
    const cities = await prisma.location.findMany();
    expect(cities).toHaveLength(9);
    expect(cities.find((c) => c.slug === 'naples')?.status).toBe('coming_soon');
  });

  it('seeds 11 services and maps hormone-optimization to trt/bhrt/menopause_hrt', async () => {
    const services = await prisma.marketingService.findMany();
    expect(services).toHaveLength(11);
    const hormone = services.find((s) => s.slug === 'hormone-optimization');
    const codes = await prisma.marketingServiceCode.findMany({
      where: { marketingServiceId: hormone!.id },
    });
    expect(codes.map((c) => c.serviceCode).sort()).toEqual(['bhrt', 'menopause_hrt', 'trt']);
  });

  it('does not duplicate alias rows when run twice', async () => {
    const stpete = await prisma.location.findUnique({ where: { slug: 'st-petersburg' } });
    const aliases = await prisma.locationAlias.findMany({ where: { locationId: stpete!.id } });
    expect(aliases).toHaveLength(4);
  });
});
