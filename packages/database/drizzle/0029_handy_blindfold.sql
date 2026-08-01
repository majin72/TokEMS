CREATE TABLE "template_asset_upload_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"media_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"content_digest" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_asset_upload_reservations" ADD CONSTRAINT "template_asset_upload_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_asset_upload_reservations" ADD CONSTRAINT "template_asset_upload_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "template_asset_upload_reservations_storage_unique" ON "template_asset_upload_reservations" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "template_asset_upload_reservations_org_expiry_idx" ON "template_asset_upload_reservations" USING btree ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "template_asset_upload_reservations_expiry_idx" ON "template_asset_upload_reservations" USING btree ("expires_at");--> statement-breakpoint
WITH normalized AS (
	SELECT
		"template_id",
		jsonb_build_object(
			'presentation', jsonb_build_object('kind', 'structured', 'home', "definition" -> 'home'),
			'faq', "definition" -> 'faq',
			'registrationFlow', "definition" -> 'registrationFlow',
			'initialization', "definition" -> 'initialization'
		) AS "definition"
	FROM "conference_template_drafts"
	WHERE "definition" ? 'home' AND NOT ("definition" ? 'presentation')
)
UPDATE "conference_template_drafts" AS draft
SET
	"schema_version" = 2,
	"definition" = normalized."definition",
	"content_digest" = 'pending-v2-digest-rebuild'
FROM normalized
WHERE draft."template_id" = normalized."template_id";--> statement-breakpoint
WITH normalized AS (
	SELECT
		"id",
		jsonb_build_object(
			'presentation', jsonb_build_object('kind', 'structured', 'home', "definition" -> 'home'),
			'faq', "definition" -> 'faq',
			'registrationFlow', "definition" -> 'registrationFlow',
			'initialization', "definition" -> 'initialization'
		) AS "definition"
	FROM "conference_template_versions"
	WHERE "definition" ? 'home' AND NOT ("definition" ? 'presentation')
)
UPDATE "conference_template_versions" AS version
SET
	"schema_version" = 2,
	"definition" = normalized."definition",
	"content_digest" = 'pending-v2-digest-rebuild'
FROM normalized
WHERE version."id" = normalized."id";--> statement-breakpoint
UPDATE "conference_template_drafts"
SET "schema_version" = 2
WHERE "definition" ? 'presentation' AND "schema_version" <> 2;--> statement-breakpoint
UPDATE "conference_template_versions"
SET "schema_version" = 2
WHERE "definition" ? 'presentation' AND "schema_version" <> 2;
