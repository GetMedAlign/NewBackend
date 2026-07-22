-- Billing subsystem 2 hardening: DB-level uniqueness on invoices so
-- invoice-generation idempotency and the webhook stripe-id lookup have a
-- database backstop (not just application-level checks).

ALTER TABLE invoices
  ADD CONSTRAINT "invoices_clinic_period_key" UNIQUE ("clinic_id", "period_start", "period_end");

ALTER TABLE invoices
  ADD CONSTRAINT "invoices_stripe_invoice_id_key" UNIQUE ("stripe_invoice_id");
