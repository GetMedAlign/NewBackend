/** Formats as UTC `yyyy-MM-dd`. UTC keeps the output deterministic regardless of server timezone. */
export function formatDateOnly(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
}
