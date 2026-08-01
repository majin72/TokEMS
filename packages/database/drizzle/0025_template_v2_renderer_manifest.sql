UPDATE "template_packages"
SET "manifest" = jsonb_set("manifest", '{schemaVersions}', '[1, 2]'::jsonb, true),
    "updated_at" = now()
WHERE "key" IN ('editorial-blue', 'executive-classic');
--> statement-breakpoint
INSERT INTO "template_packages" (
  "id",
  "key",
  "name",
  "version",
  "status",
  "description",
  "manifest",
  "created_at",
  "updated_at"
)
VALUES (
  '17171717-1717-4171-8171-171717171717',
  'html-liquid-v1',
  'HTML 智能模板',
  1,
  'published',
  '安全导入静态 HTML，通过受控变量清单生成大会首页。',
  '{"entry":"html-document","theme":"imported","supports":["site"],"schemaVersions":[2],"compilerVersion":1}'::jsonb,
  now(),
  now()
)
ON CONFLICT ("key", "version") DO UPDATE
SET "status" = EXCLUDED."status",
    "description" = EXCLUDED."description",
    "manifest" = EXCLUDED."manifest",
    "updated_at" = now();
