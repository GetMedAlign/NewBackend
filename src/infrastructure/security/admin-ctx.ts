/** The admin identity every admin repository call runs under. */
export interface AdminCtx {
  userId: string;
  role: string;
  ip: string | null;
}
