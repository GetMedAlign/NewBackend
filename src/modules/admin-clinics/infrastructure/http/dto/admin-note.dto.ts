/**
 * Note returned by GET /admin/clinics/:id/notes (array, newest-first) and
 * POST /admin/clinics/:id/notes (single object). All camelCase (spec §1.5).
 */
export interface AdminNote {
  id: string;
  createdAt: string;
  authorName: string;
  body: string;
}
