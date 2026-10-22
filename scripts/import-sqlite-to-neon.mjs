import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const sourcePath = process.env.SQLITE_SOURCE || join(process.cwd(), 'data/academy.sqlite');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`);

const tables = [
  ['users', 'id'], ['courses', 'id'], ['lessons', 'id'], ['questions', 'id'],
  ['enrollments', 'user_id,course_id'], ['completions', 'user_id,lesson_id'],
  ['attempts', 'id'], ['lesson_notes', 'user_id,lesson_id'], ['submissions', 'id'],
  ['bookmarks', 'user_id,article_id'], ['notification_reads', 'user_id,item_key']
];
const sqlite = new DatabaseSync(sourcePath, { readOnly: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await pool.query(readFileSync(join(process.cwd(), 'migrations/001_postgres.sql'), 'utf8'));
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const [table] of tables) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      counts[table] = rows.length;
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = Object.values(row);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
        await client.query(
          `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT (${tables.find(([name]) => name === table)[1]}) DO NOTHING`,
          values
        );
      }
    }
    for (const [table, key] of tables) {
      if (key !== 'id') continue;
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1), EXISTS(SELECT 1 FROM ${table}))`
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('SQLite rows copied to Neon (conflicts preserved):');
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count}`);
  console.log('Session tokens were intentionally not copied.');
} finally {
  sqlite.close();
  await pool.end();
}
