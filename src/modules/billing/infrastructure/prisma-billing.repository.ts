import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  BillingRepositoryPort,
  ClinicBillingContext,
  BillingProfileRow,
  ClinicCtx,
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
}
