UPDATE "conference_template_drafts"
SET "schema_version" = 2,
    "content_digest" = 'pending-v2-digest-rebuild'
WHERE "schema_version" = 2 OR "definition" ? 'presentation';--> statement-breakpoint
UPDATE "conference_template_versions"
SET "schema_version" = 2,
    "content_digest" = 'pending-v2-digest-rebuild'
WHERE "schema_version" = 2 OR "definition" ? 'presentation';
