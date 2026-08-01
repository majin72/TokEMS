SET LOCAL lock_timeout = '5s';--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "orders" o
    JOIN "registrations" r ON r."id" = o."registration_id"
    WHERE o."organization_id" <> r."organization_id"
       OR o."event_id" <> r."event_id"
  ) THEN
    RAISE EXCEPTION 'orders contain registration scope mismatches; repair organization_id/event_id before migration 0019';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "invoice_requests" i
    JOIN "orders" o ON o."id" = i."order_id"
    WHERE i."registration_id" <> o."registration_id"
       OR i."organization_id" <> o."organization_id"
       OR i."event_id" <> o."event_id"
  ) THEN
    RAISE EXCEPTION 'invoice_requests contain order scope mismatches; repair registration_id/organization_id/event_id before migration 0019';
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_business_tuple_unique" ON "orders" USING btree ("id","registration_id","organization_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_business_tuple_unique" ON "registrations" USING btree ("id","organization_id","event_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_registration_scope_fk" FOREIGN KEY ("registration_id","organization_id","event_id") REFERENCES "public"."registrations"("id","organization_id","event_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_order_scope_fk" FOREIGN KEY ("order_id","registration_id","organization_id","event_id") REFERENCES "public"."orders"("id","registration_id","organization_id","event_id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "orders" VALIDATE CONSTRAINT "orders_registration_scope_fk";--> statement-breakpoint
ALTER TABLE "invoice_requests" VALIDATE CONSTRAINT "invoice_requests_order_scope_fk";
