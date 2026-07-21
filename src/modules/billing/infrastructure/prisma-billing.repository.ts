import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  BillingRepositoryPort,
  ClinicBillingContext,
  BillingProfileRow,
  ClinicCtx,
  UpdateBillingProfileInput,
  UpsertProfileResult,
} from '../domain/ports/billing-repository.port';

type ClinicContextRow = {
  clinicId: string;
  createdAt: Date;
  status: string;
  billingStatus: string;
  stripeCustomerId: string | null;
};

type BillingProfileDbRow = {
  billingEmail: string | null;
  billingContactName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  taxId: string | null;
  stripeCustomerId: string | null;
};

type CountRow = { count: bigint };

type OldValueRow = { stripeCustomerId: string | null; billingEmail: string | null };

@Injectable()
export class PrismaBillingRepository implements BillingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getClinicContext(ctx: ClinicCtx): Promise<ClinicBillingContext | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<ClinicContextRow[]>`
          SELECT
            id                  AS "clinicId",
            created_at          AS "createdAt",
            status,
            billing_status      AS "billingStatus",
            stripe_customer_id  AS "stripeCustomerId"
          FROM clinics
          WHERE id = ${ctx.clinicId}::uuid
        `;
        return rows[0] ?? null;
      },
    );
  }

  async getProfile(ctx: ClinicCtx): Promise<BillingProfileRow | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<BillingProfileDbRow[]>`
          SELECT
            billing_email         AS "billingEmail",
            billing_contact_name  AS "billingContactName",
            address_line1         AS "addressLine1",
            address_line2         AS "addressLine2",
            city,
            state_code            AS "stateCode",
            zip_code              AS "zipCode",
            tax_id                AS "taxId",
            stripe_customer_id    AS "stripeCustomerId"
          FROM billing_profiles
          WHERE clinic_id = ${ctx.clinicId}::uuid
        `;
        return rows[0] ?? null;
      },
    );
  }

  async countInvoices(ctx: ClinicCtx): Promise<number> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<CountRow[]>`
          SELECT count(*) AS count FROM invoices WHERE clinic_id = ${ctx.clinicId}::uuid
        `;
        return Number(rows[0]?.count ?? 0);
      },
    );
  }

  async countCurrentMonthLeads(ctx: ClinicCtx, now: Date): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<CountRow[]>`
          SELECT count(*) AS count FROM leads
          WHERE clinic_id = ${ctx.clinicId}::uuid AND received_at >= ${monthStart}
        `;
        return Number(rows[0]?.count ?? 0);
      },
    );
  }

  async upsertProfile(
    ctx: ClinicCtx,
    input: UpdateBillingProfileInput,
  ): Promise<UpsertProfileResult> {
    const fields: { column: string; value: string | undefined }[] = [
      { column: 'billing_email', value: input.billingEmail },
      { column: 'billing_contact_name', value: input.billingContactName },
      { column: 'address_line1', value: input.addressLine1 },
      { column: 'address_line2', value: input.addressLine2 },
      { column: 'city', value: input.city },
      { column: 'state_code', value: input.stateCode },
      { column: 'zip_code', value: input.zipCode },
      { column: 'tax_id', value: input.taxId },
    ];
    const present = fields.filter(
      (f): f is { column: string; value: string } => f.value !== undefined,
    );

    const insertColumns = [Prisma.raw('clinic_id'), ...present.map((f) => Prisma.raw(f.column))];
    const insertValues = [
      Prisma.sql`${ctx.clinicId}::uuid`,
      ...present.map((f) => Prisma.sql`${f.value}`),
    ];
    const updateSets = [
      ...present.map((f) => Prisma.sql`${Prisma.raw(f.column)} = ${f.value}`),
      Prisma.sql`updated_at = now()`,
    ];

    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const oldRows = await tx.$queryRaw<OldValueRow[]>`
          SELECT
            c.stripe_customer_id AS "stripeCustomerId",
            bp.billing_email     AS "billingEmail"
          FROM clinics c
          LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
          WHERE c.id = ${ctx.clinicId}::uuid
        `;
        const oldRow = oldRows[0] ?? null;

        await tx.$executeRaw`
          INSERT INTO billing_profiles (${Prisma.join(insertColumns, ', ')})
          VALUES (${Prisma.join(insertValues, ', ')})
          ON CONFLICT (clinic_id) DO UPDATE SET ${Prisma.join(updateSets, ', ')}
        `;

        return {
          oldEmail: oldRow?.billingEmail ?? null,
          stripeCustomerId: oldRow?.stripeCustomerId ?? null,
        };
      },
    );
  }
}
