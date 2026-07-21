/** The .NET AdminBillingStatus set. This slice only writes NO_CARD and CURRENT;
 *  the others are set by subsystem 2. */
export const BILLING_STATUS = {
  CURRENT: 'current',
  OVERDUE: 'overdue',
  NO_CARD: 'no_card',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
} as const;
