import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  CITY_SEED,
  SERVICE_SEED,
  citySeoTitle,
  citySeoDescription,
  cityIntro,
  serviceSeoTitle,
  serviceSeoDescription,
} from '../../src/modules/localization/domain/localization-seed-data';

export async function seedLocalization(prisma: PrismaClient): Promise<void> {
  // Setting (singleton).
  await prisma.localizationSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', minClinics: 2 },
  });

  // Cities.
  for (let i = 0; i < CITY_SEED.length; i++) {
    const c = CITY_SEED[i];
    const data = {
      name: c.name,
      stateCode: 'FL',
      status: c.status,
      area: c.area,
      intro: cityIntro(c.area),
      seoTitle: citySeoTitle(c.name),
      seoDescription: citySeoDescription(c.name),
      displayOrder: i,
    };
    const location = await prisma.location.upsert({
      where: { slug: c.slug },
      update: data,
      create: { slug: c.slug, ...data },
    });
    await prisma.$transaction([
      prisma.locationAlias.deleteMany({ where: { locationId: location.id } }),
      prisma.locationAlias.createMany({
        data: c.aliases.map((alias) => ({ locationId: location.id, alias })),
      }),
      prisma.locationNear.deleteMany({ where: { locationId: location.id } }),
      prisma.locationNear.createMany({
        data: c.nearSlugs.map((nearSlug, order) => ({
          locationId: location.id,
          nearSlug,
          displayOrder: order,
        })),
      }),
    ]);
  }

  // Services + mapping + related.
  for (let i = 0; i < SERVICE_SEED.length; i++) {
    const s = SERVICE_SEED[i];
    const data = {
      name: s.name,
      description: s.description,
      status: 'active',
      seoTitle: serviceSeoTitle(s.name),
      seoDescription: serviceSeoDescription(s.description),
      displayOrder: i,
    };
    const service = await prisma.marketingService.upsert({
      where: { slug: s.slug },
      update: data,
      create: { slug: s.slug, ...data },
    });
    await prisma.$transaction([
      prisma.marketingServiceCode.deleteMany({ where: { marketingServiceId: service.id } }),
      prisma.marketingServiceCode.createMany({
        data: s.codes.map((serviceCode) => ({ marketingServiceId: service.id, serviceCode })),
      }),
      prisma.marketingServiceRelated.deleteMany({ where: { marketingServiceId: service.id } }),
      prisma.marketingServiceRelated.createMany({
        data: s.relatedSlugs.map((relatedSlug, order) => ({
          marketingServiceId: service.id,
          relatedSlug,
          displayOrder: order,
        })),
      }),
    ]);
  }
}

/** CLI entry point: `pnpm seed:localization`. */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await seedLocalization(prisma);
    // eslint-disable-next-line no-console
    console.log('Localization seed complete.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Run directly (ts-node) but not when imported by tests.
if (require.main === module) {
  void main();
}
