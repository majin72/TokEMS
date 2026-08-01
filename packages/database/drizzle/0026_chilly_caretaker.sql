CREATE TABLE "template_html_import_assets" (
	"import_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"staged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_html_import_assets_import_id_asset_id_pk" PRIMARY KEY("import_id","asset_id")
);
--> statement-breakpoint
ALTER TABLE "template_html_import_assets" ADD CONSTRAINT "template_html_import_assets_import_id_template_html_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."template_html_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_import_assets" ADD CONSTRAINT "template_html_import_assets_asset_id_template_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."template_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_html_import_assets" ADD CONSTRAINT "template_html_import_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_html_import_assets_org_asset_idx" ON "template_html_import_assets" USING btree ("organization_id","asset_id");