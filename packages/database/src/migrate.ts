import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeConferenceTemplateDefinition } from '@conference/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { createDatabase, type ConferenceDatabase } from './index.js';
import { conferenceTemplateDrafts, conferenceTemplateVersions } from './schema.js';

const TEMPLATE_DIGEST_REBUILD_MARKER = 'pending-v2-digest-rebuild';
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * Hashes a template definition the same way seed / rebuild tooling expects.
 *
 * @param value - Normalized conference template definition payload.
 * @returns SHA-256 hex digest of the canonical JSON.
 */
function templateDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Applies each Drizzle SQL migration in its own committed transaction.
 *
 * Stock `drizzle-orm` wraps every pending migration in a single transaction.
 * PostgreSQL rejects using freshly `ADD VALUE`'d enum labels until that
 * transaction commits (SQLSTATE 55P04), so payment attempt migrations that
 * both extend `payment_status` and create a partial index on the new labels
 * cannot run under the stock migrator.
 *
 * @param db - Conference Drizzle database handle.
 * @param pool - Underlying `pg` pool used for journal reads.
 * @param migrationsFolder - Absolute path to the `drizzle/` SQL folder.
 */
async function migrateEachInOwnTransaction(
  db: ConferenceDatabase,
  pool: { query: (text: string) => Promise<{ rows: Array<{ created_at: string }> }> },
  migrationsFolder: string,
) {
  const migrations = readMigrationFiles({ migrationsFolder });

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const applied = await pool.query(
    `select id, hash, created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at desc limit 1`,
  );

  let lastCreatedAt = applied.rows[0] ? Number(applied.rows[0].created_at) : undefined;

  for (const migration of migrations) {
    if (lastCreatedAt !== undefined && !(lastCreatedAt < migration.folderMillis)) {
      continue;
    }

    await db.transaction(async (tx) => {
      for (const statement of migration.sql) {
        const trimmed = statement.trim();
        if (!trimmed) continue;
        await tx.execute(sql.raw(trimmed));
      }
      await tx.execute(
        sql`insert into ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} ("hash", "created_at") values(${migration.hash}, ${migration.folderMillis})`,
      );
    });

    lastCreatedAt = migration.folderMillis;
  }
}

/**
 * Rebuilds template digests that were marked pending after the v2 cutover.
 */
async function rebuildTemplateDigests() {
  const [drafts, versions] = await Promise.all([
    db
      .select({
        templateId: conferenceTemplateDrafts.templateId,
        definition: conferenceTemplateDrafts.definition,
      })
      .from(conferenceTemplateDrafts)
      .where(eq(conferenceTemplateDrafts.contentDigest, TEMPLATE_DIGEST_REBUILD_MARKER)),
    db
      .select({
        id: conferenceTemplateVersions.id,
        definition: conferenceTemplateVersions.definition,
      })
      .from(conferenceTemplateVersions)
      .where(eq(conferenceTemplateVersions.contentDigest, TEMPLATE_DIGEST_REBUILD_MARKER)),
  ]);
  if (!drafts.length && !versions.length) return;
  await db.transaction(async (tx) => {
    for (const draft of drafts) {
      const definition = normalizeConferenceTemplateDefinition(draft.definition);
      await tx
        .update(conferenceTemplateDrafts)
        .set({ schemaVersion: 2, definition, contentDigest: templateDigest(definition) })
        .where(
          and(
            eq(conferenceTemplateDrafts.templateId, draft.templateId),
            eq(conferenceTemplateDrafts.contentDigest, TEMPLATE_DIGEST_REBUILD_MARKER),
          ),
        );
    }
    for (const version of versions) {
      const definition = normalizeConferenceTemplateDefinition(version.definition);
      await tx
        .update(conferenceTemplateVersions)
        .set({ schemaVersion: 2, definition, contentDigest: templateDigest(definition) })
        .where(
          and(
            eq(conferenceTemplateVersions.id, version.id),
            eq(conferenceTemplateVersions.contentDigest, TEMPLATE_DIGEST_REBUILD_MARKER),
          ),
        );
    }
  });
  console.info(`Template digests rebuilt: drafts=${drafts.length} versions=${versions.length}`);
}

const { db, pool } = createDatabase();

try {
  await migrateEachInOwnTransaction(
    db,
    pool,
    fileURLToPath(new URL('../drizzle', import.meta.url)),
  );
  await rebuildTemplateDigests();
  console.info('Database migrations completed');
} finally {
  await pool.end();
}
