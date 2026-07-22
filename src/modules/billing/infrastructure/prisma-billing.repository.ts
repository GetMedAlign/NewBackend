import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  BillingRepositoryPort,
  ClinicBillingContext,
  BillingProfileRow,
  ClinicCtx,
  ClinicStripeCustomer,
  UpdateBillingProfileInput,
  UpsertProfileResult,
  AdminBillingCtx,
  AdminBillingRow,
  AdminInvoiceRow,
  AdminClinicBillingResult,
  EligibleClinic,
  OverdueClinic,
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

type StripeCustomerRow = { stripeCustomerId: string | null; billingStatus: string };

type AdminBillingDbRow = AdminBillingRow;

/** Raw row shape from `listInvoiceEligibleClinics`, before the non-null assertion on stripeCustomerId. */
type EligibleClinicDbRow = {
  clinicId: string;
  clinicName: string;
  createdAt: Date;
  stripeCustomerId: string | null;
  billingEmail: string | null;
};

/** Raw row shape from `listSuspendableClinics`, before the Number(overdueTotal) conversion. */
type OverdueClinicDbRow = {
  clinicId: string;
  clinicName: string;
  billingEmail: string | null;
  overdueTotal: string;
  overdueDueDate: Date | null;
};

/** Raw row shape from the §1.7 invoices query, before the ISO-string/Number conversions. */
type AdminInvoiceDbRow = {
  id: string;
  period_start: Date;
  period_end: Date;
  lead_count: number;
  total_amount: number;
  status: string;
  due_date: Date | null;
  paid_at: Date | null;
  invoice_url: string | null;
};

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
    // A field absent (undefined) or explicitly null leaves the column
    // unchanged (spec §1.2) — class-validator's @IsOptional() lets `null`
    // through validation, so both must be excluded here, not just undefined.
    const present = fields.filter(
      (f): f is { column: string; value: string } => f.value !== undefined && f.value !== null,
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

  async getClinicStripeCustomerId(ctx: ClinicCtx): Promise<ClinicStripeCustomer | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<StripeCustomerRow[]>`
          SELECT
            stripe_customer_id AS "stripeCustomerId",
            billing_status     AS "billingStatus"
          FROM clinics
          WHERE id = ${ctx.clinicId}::uuid
        `;
        return rows[0] ?? null;
      },
    );
  }

  async setBillingStatus(ctx: ClinicCtx, status: string): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        await tx.$executeRaw`
          UPDATE clinics SET billing_status = ${status} WHERE id = ${ctx.clinicId}::uuid
        `;
      },
    );
  }

  async cancelSubscription(
    ctx: ClinicCtx,
    cancelledAt: Date,
    activeThrough: Date,
  ): Promise<'ok' | 'already_cancelled'> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: ctx.clinicId },
      async (tx) => {
        const result = await tx.$executeRaw`
          UPDATE clinics
          SET subscription_cancelled_at = ${cancelledAt},
              subscription_active_through = ${activeThrough},
              billing_status = 'cancelled',
              notify_on_lead = false
          WHERE id = ${ctx.clinicId}::uuid AND subscription_cancelled_at IS NULL
        `;
        if (result > 0) return 'ok';

        // 0 rows affected: either the clinic doesn't exist (impossible —
        // ClinicGuard already validated the session) or it's already
        // cancelled. Confirm existence to be explicit about which case this is.
        const existsRows = await tx.$queryRaw<{ exists: number }[]>`
          SELECT 1 AS exists FROM clinics WHERE id = ${ctx.clinicId}::uuid
        `;
        if (existsRows.length === 0) {
          throw new Error(`Clinic ${ctx.clinicId} not found during subscription cancel`);
        }
        return 'already_cancelled';
      },
    );
  }

  async getAdminClinicBilling(
    ctx: AdminBillingCtx,
    clinicId: string,
  ): Promise<AdminClinicBillingResult | null> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: null },
      async (tx) => {
        const rows = await tx.$queryRaw<AdminBillingDbRow[]>`
          SELECT
            c.id                                              AS "clinicId",
            c.status,
            COALESCE(bp.stripe_customer_id, c.stripe_customer_id) AS "stripeCustomerId",
            bp.billing_email                                  AS "billingEmail"
          FROM clinics c
          LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
          WHERE c.id = ${clinicId}::uuid
        `;
        const row = rows[0];
        if (!row) return null;

        const invoiceRows = await tx.$queryRaw<AdminInvoiceDbRow[]>`
          SELECT
            id,
            period_start,
            period_end,
            lead_count,
            total_amount,
            status,
            due_date,
            paid_at,
            invoice_url
          FROM invoices
          WHERE clinic_id = ${clinicId}::uuid
          ORDER BY period_start DESC
        `;

        const invoices: AdminInvoiceRow[] = invoiceRows.map((inv) => ({
          id: inv.id,
          period_start: inv.period_start.toISOString(),
          period_end: inv.period_end.toISOString(),
          lead_count: Number(inv.lead_count),
          total_amount: Number(inv.total_amount),
          status: inv.status,
          due_date: inv.due_date ? inv.due_date.toISOString() : null,
          paid_at: inv.paid_at ? inv.paid_at.toISOString() : null,
          invoice_url: inv.invoice_url,
        }));

        return { row, invoices };
      },
    );
  }

  async setClinicStripeCustomerId(
    ctx: AdminBillingCtx,
    clinicId: string,
    customerId: string,
  ): Promise<void> {
    await this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: null },
      async (tx) => {
        await tx.$executeRaw`
          UPDATE clinics SET stripe_customer_id = ${customerId} WHERE id = ${clinicId}::uuid
        `;
      },
    );
  }

  async listInvoiceEligibleClinics(periodStart: Date, periodEnd: Date): Promise<EligibleClinic[]> {
    return this.prisma.asSystem(async (client) => {
      const rows = await client.$queryRaw<EligibleClinicDbRow[]>`
        SELECT c.id AS "clinicId", c.name AS "clinicName", c.created_at AS "createdAt",
               c.stripe_customer_id AS "stripeCustomerId",
               COALESCE(bp.billing_email, c.business_email) AS "billingEmail"
          FROM clinics c
          LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
         WHERE c.status = 'active'
           AND c.stripe_customer_id IS NOT NULL
           AND c.created_at < ${periodEnd}
           AND (c.subscription_active_through IS NULL OR c.subscription_active_through > ${periodStart})
           AND NOT EXISTS (SELECT 1 FROM invoices i
                             WHERE i.clinic_id = c.id AND i.period_start = ${periodStart} AND i.period_end = ${periodEnd})
      `;
      // WHERE c.stripe_customer_id IS NOT NULL guarantees this at the SQL
      // level; the assertion here just narrows the TS type to match the port.
      return rows.map((row) => ({ ...row, stripeCustomerId: row.stripeCustomerId! }));
    });
  }

  async countLeadsInPeriod(clinicId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    return this.prisma.asSystem(async (client) => {
      const rows = await client.$queryRaw<CountRow[]>`
        SELECT count(*) AS count FROM leads
        WHERE clinic_id = ${clinicId}::uuid
          AND received_at >= ${periodStart} AND received_at < ${periodEnd}
      `;
      return Number(rows[0]?.count ?? 0);
    });
  }

  async countInvoicesForClinic(clinicId: string): Promise<number> {
    return this.prisma.asSystem(async (client) => {
      const rows = await client.$queryRaw<CountRow[]>`
        SELECT count(*) AS count FROM invoices WHERE clinic_id = ${clinicId}::uuid
      `;
      return Number(rows[0]?.count ?? 0);
    });
  }

  async insertGeneratedInvoice(row: {
    clinicId: string;
    stripeInvoiceId: string;
    periodStart: Date;
    periodEnd: Date;
    leadCount: number;
    pricePerLead: number;
    platformFee: number;
    totalAmount: number;
    dueDate: Date;
    invoiceUrl: string | null;
    pdfUrl: string | null;
  }): Promise<void> {
    await this.prisma.asSystem((client) =>
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO invoices (
            clinic_id, stripe_invoice_id, period_start, period_end, lead_count,
            price_per_lead, platform_fee, total_amount, status, due_date, invoice_url, pdf_url
          )
          VALUES (
            ${row.clinicId}::uuid, ${row.stripeInvoiceId}, ${row.periodStart}, ${row.periodEnd}, ${row.leadCount},
            ${row.pricePerLead}, ${row.platformFee}, ${row.totalAmount}, 'open', ${row.dueDate}, ${row.invoiceUrl}, ${row.pdfUrl}
          )
        `;
      }),
    );
  }

  async listSuspendableClinics(now: Date): Promise<OverdueClinic[]> {
    return this.prisma.asSystem(async (client) => {
      const rows = await client.$queryRaw<OverdueClinicDbRow[]>`
        SELECT c.id AS "clinicId", c.name AS "clinicName",
               COALESCE(bp.billing_email, c.business_email) AS "billingEmail",
               i.total_amount::text AS "overdueTotal", i.due_date AS "overdueDueDate"
          FROM clinics c
          JOIN LATERAL (
            SELECT total_amount, due_date FROM invoices
             WHERE clinic_id = c.id AND status IN ('open','overdue')
               AND due_date + interval '30 days' < ${now}
             ORDER BY due_date DESC NULLS LAST LIMIT 1
          ) i ON true
          LEFT JOIN billing_profiles bp ON bp.clinic_id = c.id
         WHERE c.status = 'active'
      `;
      return rows.map((row) => ({ ...row, overdueTotal: Number(row.overdueTotal) }));
    });
  }

  async suspendClinicForNonPayment(clinicId: string): Promise<void> {
    await this.prisma.asSystem((client) =>
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE clinics
          SET status = 'suspended', suspension_reason = 'overdue_payment', notify_on_lead = false
          WHERE id = ${clinicId}::uuid
        `;
        await tx.$executeRaw`
          UPDATE invoices SET status = 'overdue'
          WHERE clinic_id = ${clinicId}::uuid AND status = 'open'
        `;
      }),
    );
  }
}
