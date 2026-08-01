import { createRequire } from 'node:module';

const requireFromDatabase = createRequire(
  new URL('../../packages/database/package.json', import.meta.url),
);
const { Pool } = requireFromDatabase('pg');

const defaultDatabaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://conference:conference@localhost:15432/conference';

export async function cleanupTestEvents(eventIds, databaseUrl = defaultDatabaseUrl) {
  const uniqueEventIds = [...new Set(eventIds.filter(Boolean))];
  if (uniqueEventIds.length === 0) return;

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await pool.query('delete from events where id = any($1::integer[])', [uniqueEventIds]);
        break;
      } catch (error) {
        const retryable = error?.code === '40P01' || error?.code === '40001';
        if (!retryable || attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
      }
    }
  } finally {
    await pool.end();
  }
}
