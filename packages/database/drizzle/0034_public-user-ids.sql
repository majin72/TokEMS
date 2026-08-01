SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "user_id_allocators" (
	"scope" varchar(40) PRIMARY KEY NOT NULL,
	"last_id" integer NOT NULL,
	CONSTRAINT "user_id_allocators_last_id_range" CHECK ("user_id_allocators"."last_id" between 100 and 2147483647)
);
--> statement-breakpoint
INSERT INTO "user_id_allocators" ("scope", "last_id") VALUES ('global', 100);
--> statement-breakpoint
CREATE FUNCTION "allocate_user_public_id"()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	allocated_id integer;
BEGIN
	UPDATE "user_id_allocators"
	SET "last_id" = "last_id" + 1
	WHERE "scope" = 'global'
		AND "last_id" < 2147483647
	RETURNING "last_id" INTO allocated_id;

	IF allocated_id IS NULL THEN
		RAISE EXCEPTION 'user ID range 101-2147483647 is exhausted'
			USING ERRCODE = '22003';
	END IF;

	RETURN allocated_id;
END
$$;
--> statement-breakpoint
CREATE TABLE "public_user_ids" (
	"public_id" integer PRIMARY KEY DEFAULT allocate_user_public_id() NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "public_user_ids_id_range" CHECK ("public_user_ids"."public_id" between 101 and 2147483647),
	CONSTRAINT "public_user_ids_subject_type" CHECK ("public_user_ids"."subject_type" in ('staff', 'customer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_user_ids_subject_unique" ON "public_user_ids" USING btree ("subject_type","subject_uuid");
--> statement-breakpoint
CREATE INDEX "public_user_ids_active_subject_idx" ON "public_user_ids" USING btree ("subject_type","subject_uuid","retired_at");
--> statement-breakpoint
LOCK TABLE "users", "customer_users" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
WITH designated_admin AS (
	SELECT "users"."id", "users"."created_at"
	FROM "users"
	LEFT JOIN "memberships" ON "memberships"."user_id" = "users"."id"
	ORDER BY
		("users"."id" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) DESC,
		("memberships"."role" = 'organization_admin' AND "memberships"."status" = 'active') DESC,
		"users"."created_at" ASC,
		"users"."id" ASC
	LIMIT 1
)
INSERT INTO "public_user_ids" ("public_id", "subject_type", "subject_uuid", "created_at")
SELECT 101, 'staff', "id", "created_at" FROM designated_admin;
--> statement-breakpoint
UPDATE "user_id_allocators"
SET "last_id" = coalesce((SELECT max("public_id") FROM "public_user_ids"), 100)
WHERE "scope" = 'global';
--> statement-breakpoint
INSERT INTO "public_user_ids" ("subject_type", "subject_uuid", "created_at")
SELECT "subject_type", "subject_uuid", "created_at"
FROM (
	SELECT 'staff'::varchar(20) AS "subject_type", "id" AS "subject_uuid", "created_at" FROM "users"
	UNION ALL
	SELECT 'customer'::varchar(20) AS "subject_type", "id" AS "subject_uuid", "created_at" FROM "customer_users"
) AS existing_users
WHERE NOT EXISTS (
	SELECT 1 FROM "public_user_ids"
	WHERE "public_user_ids"."subject_type" = existing_users."subject_type"
		AND "public_user_ids"."subject_uuid" = existing_users."subject_uuid"
)
ORDER BY "created_at" ASC, "subject_type" ASC, "subject_uuid" ASC;
--> statement-breakpoint
CREATE FUNCTION "register_user_public_id"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "public_user_ids"
	SET "retired_at" = NULL
	WHERE "subject_type" = TG_ARGV[0]
		AND "subject_uuid" = NEW."id";
	IF NOT FOUND THEN
		INSERT INTO "public_user_ids" ("subject_type", "subject_uuid", "created_at")
		VALUES (TG_ARGV[0], NEW."id", NEW."created_at");
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION "retire_user_public_id"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "public_user_ids"
	SET "retired_at" = now()
	WHERE "subject_type" = TG_ARGV[0]
		AND "subject_uuid" = OLD."id"
		AND "retired_at" IS NULL;
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "users_register_public_id"
AFTER INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION "register_user_public_id"('staff');
--> statement-breakpoint
CREATE TRIGGER "users_retire_public_id"
AFTER DELETE ON "users"
FOR EACH ROW EXECUTE FUNCTION "retire_user_public_id"('staff');
--> statement-breakpoint
CREATE TRIGGER "customer_users_register_public_id"
AFTER INSERT ON "customer_users"
FOR EACH ROW EXECUTE FUNCTION "register_user_public_id"('customer');
--> statement-breakpoint
CREATE TRIGGER "customer_users_retire_public_id"
AFTER DELETE ON "customer_users"
FOR EACH ROW EXECUTE FUNCTION "retire_user_public_id"('customer');
