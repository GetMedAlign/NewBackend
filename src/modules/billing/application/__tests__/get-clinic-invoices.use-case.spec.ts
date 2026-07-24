import { GetClinicInvoicesUseCase } from '../get-clinic-invoices.use-case';

describe('GetClinicInvoicesUseCase', () => {
  const repo = { listClinicInvoices: jest.fn() };
  const useCase = new GetClinicInvoicesUseCase(repo);
  const ctx = { clinicId: 'c1' };
  beforeEach(() => jest.resetAllMocks());

  it('maps repository rows to ClinicInvoiceDto, preserving order', async () => {
    repo.listClinicInvoices.mockResolvedValue([
      {
        id: 'i2',
        period_start: '2026-06-01T00:00:00.000Z',
        period_end: '2026-07-01T00:00:00.000Z',
        lead_count: 5,
        price_per_lead: 90,
        platform_fee: 49,
        total_amount: 499,
        status: 'open',
        invoice_url: 'http://x/i2',
        pdf_url: 'http://x/i2.pdf',
        due_date: '2026-07-15T00:00:00.000Z',
        paid_at: null,
      },
      {
        id: 'i1',
        period_start: '2026-05-01T00:00:00.000Z',
        period_end: '2026-06-01T00:00:00.000Z',
        lead_count: 3,
        price_per_lead: 90,
        platform_fee: 49,
        total_amount: 319,
        status: 'paid',
        invoice_url: null,
        pdf_url: null,
        due_date: '2026-06-15T00:00:00.000Z',
        paid_at: '2026-06-10T00:00:00.000Z',
      },
    ]);

    const dtos = await useCase.execute(ctx);

    expect(dtos).toHaveLength(2);
    expect(dtos[0]).toEqual({
      id: 'i2',
      period_start: '2026-06-01T00:00:00.000Z',
      period_end: '2026-07-01T00:00:00.000Z',
      lead_count: 5,
      price_per_lead: 90,
      platform_fee: 49,
      total_amount: 499,
      status: 'open',
      invoice_url: 'http://x/i2',
      pdf_url: 'http://x/i2.pdf',
      due_date: '2026-07-15T00:00:00.000Z',
      paid_at: null,
    });
    expect(dtos[1]).toEqual({
      id: 'i1',
      period_start: '2026-05-01T00:00:00.000Z',
      period_end: '2026-06-01T00:00:00.000Z',
      lead_count: 3,
      price_per_lead: 90,
      platform_fee: 49,
      total_amount: 319,
      status: 'paid',
      invoice_url: null,
      pdf_url: null,
      due_date: '2026-06-15T00:00:00.000Z',
      paid_at: '2026-06-10T00:00:00.000Z',
    });
  });

  it('returns an empty array when the clinic has no invoices', async () => {
    repo.listClinicInvoices.mockResolvedValue([]);
    const dtos = await useCase.execute(ctx);
    expect(dtos).toEqual([]);
  });
});
