import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeConferenceTemplateDefinition } from '@conference/contracts';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './index.js';
import { conferenceTemplateDrafts, conferenceTemplateVersions } from './schema.js';

const TEMPLATE_DIGEST_REBUILD_MARKER = 'pending-v2-digest-rebuild';

function templateDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

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
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  await rebuildTemplateDigests();
  console.info('Database migrations completed');
} finally {
  await pool.end();
}
