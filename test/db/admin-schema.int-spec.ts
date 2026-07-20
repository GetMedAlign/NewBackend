import { Pool } from 'pg';

describe('admin clinics/patients schema', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('creates the admin_notes table', async () => {
    const { rows } = await pool.query(`SELECT to_regclass('public.admin_notes') AS t`);
    expect(rows[0].t).not.toBeNull();
  });

  it('gives admin_notes the expected columns', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'admin_notes' ORDER BY column_name`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'author_name',
      'author_user_id',
      'body',
      'clinic_id',
      'created_at',
      'id',
    ]);
  });

  it('cascades admin_notes on clinic delete and restricts on user delete', async () => {
    const { rows } = await pool.query(
      `SELECT rc.delete_rule, kcu.column_name
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = rc.constraint_name
        WHERE kcu.table_name = 'admin_notes'
        ORDER BY kcu.column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'author_user_id', delete_rule: 'RESTRICT' },
      { column_name: 'clinic_id', delete_rule: 'CASCADE' },
    ]);
  });

  it('indexes admin_notes by clinic and created_at', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'admin_notes' AND indexname = 'admin_notes_clinic_created_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('adds zip_code and is_listed_in_directory to clinics', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'clinics'
          AND column_name IN ('zip_code', 'is_listed_in_directory')
        ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'is_listed_in_directory', is_nullable: 'NO', column_default: 'true' },
      { column_name: 'zip_code', is_nullable: 'YES', column_default: null },
    ]);
  });
});
