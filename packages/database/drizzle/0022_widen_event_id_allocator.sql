SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
DROP FUNCTION "allocate_event_id"();
--> statement-breakpoint
CREATE FUNCTION "allocate_event_id"()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	allocated_id integer;
BEGIN
	UPDATE "event_id_allocators"
	SET "last_id" = "last_id" + 1
	WHERE "scope" = 'global'
		AND "last_id" < 2147483647
	RETURNING "last_id" INTO allocated_id;

	IF allocated_id IS NULL THEN
		RAISE EXCEPTION 'event ID range 101-2147483647 is exhausted'
			USING ERRCODE = '22003';
	END IF;

	RETURN allocated_id;
END
$$;
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "id" SET DEFAULT allocate_event_id();
