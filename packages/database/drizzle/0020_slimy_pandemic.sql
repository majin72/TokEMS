SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "outbox_events"
		WHERE "published_at" IS NULL
	) THEN
		RAISE EXCEPTION 'event ID migration requires an empty unpublished outbox';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "events"
		WHERE "id" = '5cbf0482-858a-46c9-b8d3-0ddcc11340de'::uuid
			AND (
				"slug" <> 'checkin-load-1785211950943-pml46'
				OR "name" <> '百台设备并发核销验收 1785211950943-pml46'
			)
	) THEN
		RAISE EXCEPTION 'event 5cbf0482-858a-46c9-b8d3-0ddcc11340de is not the expected load-test event';
	END IF;
END
$$;
--> statement-breakpoint
DELETE FROM "outbox_events"
WHERE "event_id" = '5cbf0482-858a-46c9-b8d3-0ddcc11340de'::uuid;
--> statement-breakpoint
DELETE FROM "audit_logs"
WHERE "event_id" = '5cbf0482-858a-46c9-b8d3-0ddcc11340de'::uuid;
--> statement-breakpoint
DELETE FROM "events"
WHERE "id" = '5cbf0482-858a-46c9-b8d3-0ddcc11340de'::uuid
	AND "slug" = 'checkin-load-1785211950943-pml46'
	AND "name" = '百台设备并发核销验收 1785211950943-pml46';
--> statement-breakpoint
DO $$
BEGIN
	IF (SELECT count(*) FROM "events") > 899 THEN
		RAISE EXCEPTION 'event ID range 101-999 can hold at most 899 events';
	END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "_event_id_migration_map" (
	"legacy_id" uuid PRIMARY KEY NOT NULL,
	"new_id" smallint UNIQUE NOT NULL,
	CONSTRAINT "_event_id_migration_map_new_id_range" CHECK ("new_id" between 101 and 999)
);
--> statement-breakpoint
INSERT INTO "_event_id_migration_map" ("legacy_id", "new_id")
SELECT
	"id",
	(100 + row_number() OVER (
		ORDER BY
			CASE
				WHEN "id" = '22222222-2222-4222-8222-222222222222'::uuid THEN 0
				ELSE 1
			END,
			"created_at",
			"id"
	))::smallint
FROM "events";
--> statement-breakpoint
CREATE FUNCTION "migrate_event_id"("source_id" uuid)
RETURNS smallint
LANGUAGE sql
STABLE
AS $$
	SELECT "new_id"
	FROM "_event_id_migration_map"
	WHERE "legacy_id" = "source_id"
$$;
--> statement-breakpoint
CREATE TABLE "event_id_allocators" (
	"scope" varchar(40) PRIMARY KEY NOT NULL,
	"last_id" smallint NOT NULL,
	CONSTRAINT "event_id_allocators_last_id_range" CHECK ("last_id" between 100 and 999)
);
--> statement-breakpoint
INSERT INTO "event_id_allocators" ("scope", "last_id")
SELECT 'global', coalesce(max("new_id"), 100)::smallint
FROM "_event_id_migration_map";
--> statement-breakpoint
CREATE FUNCTION "allocate_event_id"()
RETURNS smallint
LANGUAGE plpgsql
AS $$
DECLARE
	allocated_id smallint;
BEGIN
	UPDATE "event_id_allocators"
	SET "last_id" = "last_id" + 1
	WHERE "scope" = 'global'
		AND "last_id" < 999
	RETURNING "last_id" INTO allocated_id;

	IF allocated_id IS NULL THEN
		RAISE EXCEPTION 'event ID range 101-999 is exhausted'
			USING ERRCODE = '22003';
	END IF;

	RETURN allocated_id;
END
$$;
--> statement-breakpoint
DELETE FROM "idempotency_keys" AS "key"
WHERE "key"."response_body"::text LIKE '%5cbf0482-858a-46c9-b8d3-0ddcc11340de%'
	OR EXISTS (
		SELECT 1
		FROM "_event_id_migration_map" AS "map"
		WHERE "key"."response_body"::text LIKE '%' || "map"."legacy_id"::text || '%'
	);
--> statement-breakpoint
UPDATE "audit_logs" AS "audit"
SET "resource_id" = "map"."new_id"::text
FROM "_event_id_migration_map" AS "map"
WHERE "audit"."resource_type" = 'event'
	AND "audit"."resource_id" = "map"."legacy_id"::text;
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_registration_scope_fk";
--> statement-breakpoint
ALTER TABLE "invoice_requests" DROP CONSTRAINT "invoice_requests_order_scope_fk";
--> statement-breakpoint
ALTER TABLE "ai_runs" DROP CONSTRAINT "ai_runs_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "checkin_devices" DROP CONSTRAINT "checkin_devices_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "checkin_lists" DROP CONSTRAINT "checkin_lists_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "checkin_records" DROP CONSTRAINT "checkin_records_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "checkin_sync_batches" DROP CONSTRAINT "checkin_sync_batches_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_releases" DROP CONSTRAINT "event_releases_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_template_bindings" DROP CONSTRAINT "event_template_bindings_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_template_overrides" DROP CONSTRAINT "event_template_overrides_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_reservations" DROP CONSTRAINT "inventory_reservations_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "invoice_requests" DROP CONSTRAINT "invoice_requests_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "registration_forms" DROP CONSTRAINT "registration_forms_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "speakers" DROP CONSTRAINT "speakers_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_quotas" DROP CONSTRAINT "ticket_quotas_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "ticket_types" DROP CONSTRAINT "ticket_types_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "waitlist_entries" DROP CONSTRAINT "waitlist_entries_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_runs"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "audit_logs"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "checkin_devices"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "checkin_lists"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "checkin_records"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "checkin_sync_batches"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "event_releases"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "event_template_bindings"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "event_template_overrides"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "inventory_reservations"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "invoice_requests"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "notification_deliveries"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "orders"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "outbox_events"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "refunds"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "registration_forms"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "registrations"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "sessions"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "speakers"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "ticket_quotas"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "ticket_types"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "tickets"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "waitlist_entries"
	ALTER COLUMN "event_id" TYPE smallint USING "migrate_event_id"("event_id");
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "events"
	ALTER COLUMN "id" TYPE smallint USING "migrate_event_id"("id");
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" SET DEFAULT "allocate_event_id"();
--> statement-breakpoint
ALTER TABLE "events"
	ADD CONSTRAINT "events_id_range" CHECK ("id" between 101 and 999);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkin_devices" ADD CONSTRAINT "checkin_devices_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkin_lists" ADD CONSTRAINT "checkin_lists_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkin_records" ADD CONSTRAINT "checkin_records_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "checkin_sync_batches" ADD CONSTRAINT "checkin_sync_batches_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_releases" ADD CONSTRAINT "event_releases_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_template_bindings" ADD CONSTRAINT "event_template_bindings_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_template_overrides" ADD CONSTRAINT "event_template_overrides_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_forms" ADD CONSTRAINT "registration_forms_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "speakers" ADD CONSTRAINT "speakers_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_quotas" ADD CONSTRAINT "ticket_quotas_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_types" ADD CONSTRAINT "ticket_types_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_registration_scope_fk"
	FOREIGN KEY ("registration_id", "organization_id", "event_id")
	REFERENCES "public"."registrations"("id", "organization_id", "event_id")
	ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_order_scope_fk"
	FOREIGN KEY ("order_id", "registration_id", "organization_id", "event_id")
	REFERENCES "public"."orders"("id", "registration_id", "organization_id", "event_id")
	ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_registration_scope_fk";
--> statement-breakpoint
ALTER TABLE "invoice_requests" VALIDATE CONSTRAINT "invoice_requests_order_scope_fk";
--> statement-breakpoint
DROP FUNCTION "migrate_event_id"(uuid);
--> statement-breakpoint
DROP TABLE "_event_id_migration_map";
