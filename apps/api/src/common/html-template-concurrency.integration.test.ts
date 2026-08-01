import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_IDS } from '@conference/contracts';
import {
  aiRuns,
  auditLogs,
  conferenceTemplates,
  outboxEvents,
  templateAssetUploadReservations,
  templateAssets,
  templateHtmlDocuments,
  templateHtmlImportAssets,
  templateHtmlImports,
} from '@conference/database';
import { sanitizeHtmlTemplate, sha256Digest } from '@conference/html-template';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { ConferenceRepository } from './conference.repository.js';
import { DatabaseService } from './database.service.js';
import { HtmlTemplateOperationsService } from './html-template-operations.service.js';
import { TemplateOperationsService } from './template-operations.service.js';

const describePersistent = process.env.DATABASE_URL ? describe : describe.skip;

describePersistent('HTML template import concurrency', () => {
  const database = new DatabaseService();
  const repository = new ConferenceRepository(database);
  const service = new HtmlTemplateOperationsService(database, repository);
  const templateService = new TemplateOperationsService(database);
  const importId = randomUUID();
  const scanImportId = randomUUID();
  const assetId = randomUUID();
  const leasedAssetId = randomUUID();
  const templateName = `HTML 并发提交验收 ${importId.slice(0, 8)}`;
  const idempotentTemplateName = `模板幂等恢复验收 ${importId.slice(0, 8)}`;
  const savedEventTemplateName = `大会另存幂等恢复验收 ${importId.slice(0, 8)}`;
  const reservationStorageKeys: string[] = [];
  const aiRunIds: string[] = [];
  const source =
    '<!doctype html><html lang="zh-CN"><head><title>并发验收</title></head><body><main><h1>并发验收大会</h1></main></body></html>';
  const sanitized = sanitizeHtmlTemplate(source);

  beforeAll(async () => {
    await database.db!.insert(templateHtmlImports).values({
      id: importId,
      organizationId: DEMO_IDS.organization,
      mode: 'create',
      status: 'ready',
      originalFilename: 'concurrent-import.html',
      sourceStorageKey: `template-imports/${DEMO_IDS.organization}/${importId}/source.html`,
      sourceDigest: sanitized.sourceDigest,
      sourceSize: Buffer.byteLength(source),
      sanitizedHtml: sanitized.sanitizedHtml,
      sanitizedDigest: sanitized.sanitizedDigest,
      nodeManifest: sanitized.nodeManifest as unknown as Array<Record<string, unknown>>,
      assetManifest: sanitized.resourceManifest as unknown as Array<Record<string, unknown>>,
      securityReport: sanitized.securityReport as unknown as Record<string, unknown>,
      requestedMetadata: { name: templateName },
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: DEMO_IDS.adminUser,
    });
    await database.db!.insert(templateAssets).values({
      id: leasedAssetId,
      organizationId: DEMO_IDS.organization,
      storageKey: `templates/${DEMO_IDS.organization}/lease-${leasedAssetId}.png`,
      mediaType: 'image/png',
      size: 67,
      width: 1,
      height: 1,
      contentDigest: leasedAssetId.replaceAll('-', ''),
      altText: 'HTML 导入租约验收',
      createdBy: DEMO_IDS.adminUser,
    });
    await database.db!.insert(templateHtmlImports).values({
      id: scanImportId,
      organizationId: DEMO_IDS.organization,
      mode: 'create',
      status: 'awaiting_upload',
      originalFilename: 'cancel-during-scan.html',
      sourceStorageKey: `template-imports/${DEMO_IDS.organization}/${scanImportId}/source.html`,
      sourceDigest: sanitized.sourceDigest,
      sourceSize: Buffer.byteLength(source),
      requestedMetadata: { name: `${templateName} 扫描取消` },
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: DEMO_IDS.adminUser,
    });
    await database.db!.insert(templateHtmlImportAssets).values({
      importId: scanImportId,
      assetId: leasedAssetId,
      organizationId: DEMO_IDS.organization,
      staged: false,
    });
  });

  afterAll(async () => {
    const roots = await database
      .db!.select({ id: conferenceTemplates.id })
      .from(conferenceTemplates)
      .where(
        inArray(conferenceTemplates.name, [
          templateName,
          idempotentTemplateName,
          savedEventTemplateName,
        ]),
      );
    if (reservationStorageKeys.length) {
      await database
        .db!.delete(templateAssetUploadReservations)
        .where(inArray(templateAssetUploadReservations.storageKey, reservationStorageKeys));
    }
    await database
      .db!.delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, DEMO_IDS.organization),
          like(outboxEvents.correlationId, `%${scanImportId}%`),
        ),
      );
    await database
      .db!.delete(auditLogs)
      .where(inArray(auditLogs.resourceId, [importId, scanImportId]));
    if (aiRunIds.length) {
      await database.db!.delete(auditLogs).where(inArray(auditLogs.resourceId, aiRunIds));
    }
    await database.db!.delete(templateHtmlImports).where(eq(templateHtmlImports.id, importId));
    await database.db!.delete(templateHtmlImports).where(eq(templateHtmlImports.id, scanImportId));
    await database.db!.delete(templateAssets).where(eq(templateAssets.id, assetId));
    await database.db!.delete(templateAssets).where(eq(templateAssets.id, leasedAssetId));
    if (roots.length) {
      const ids = roots.map((root) => root.id);
      await database
        .db!.delete(outboxEvents)
        .where(inArray(sql<string>`${outboxEvents.payload}->>'templateId'`, ids));
      await database.db!.delete(auditLogs).where(inArray(auditLogs.resourceId, ids));
      await database.db!.delete(conferenceTemplates).where(inArray(conferenceTemplates.id, ids));
    }
    await database.onModuleDestroy();
  });

  it('commits one template when different requests race on the same ready import', async () => {
    const input = {
      bindings: { version: 1 as const, bindings: [] },
      confirmWarnings: false,
      name: templateName,
    };
    const [left, right] = await Promise.all([
      service.commitImport(DEMO_IDS.organization, importId, DEMO_IDS.adminUser, input),
      service.commitImport(DEMO_IDS.organization, importId, DEMO_IDS.adminUser, input),
    ]);

    expect(right).toEqual(left);
    const roots = await database
      .db!.select({ id: conferenceTemplates.id })
      .from(conferenceTemplates)
      .where(eq(conferenceTemplates.name, templateName));
    expect(roots).toEqual([{ id: left.templateId }]);
    const documents = await database
      .db!.select({ id: templateHtmlDocuments.id })
      .from(templateHtmlDocuments)
      .where(eq(templateHtmlDocuments.templateId, left.templateId));
    expect(documents).toEqual([{ id: left.documentId }]);
  });

  it('recovers the same template after an idempotency response write is lost', async () => {
    const input = {
      name: idempotentTemplateName,
      description: '验证业务命令可以稳定恢复原模板。',
      tags: ['幂等恢复'],
      publishImmediately: false,
    };
    const commandKey = `template-create-${randomUUID()}`;
    const [first, second] = await Promise.all([
      templateService.create(DEMO_IDS.organization, DEMO_IDS.adminUser, input, commandKey),
      templateService.create(DEMO_IDS.organization, DEMO_IDS.adminUser, input, commandKey),
    ]);

    expect(second.summary.id).toBe(first.summary.id);
    const roots = await database
      .db!.select({ id: conferenceTemplates.id })
      .from(conferenceTemplates)
      .where(eq(conferenceTemplates.name, idempotentTemplateName));
    expect(roots).toEqual([{ id: first.summary.id }]);
  });

  it('recovers the original AI mapping run after the HTML draft changes', async () => {
    const previous = {
      enabled: process.env.HTML_TEMPLATE_AI_MAPPING_ENABLED,
      apiUrl: process.env.AI_API_URL,
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL,
      minuteLimit: process.env.HTML_TEMPLATE_AI_ORG_MINUTE_LIMIT,
      dailyLimit: process.env.HTML_TEMPLATE_AI_ORG_DAILY_LIMIT,
    };
    process.env.HTML_TEMPLATE_AI_MAPPING_ENABLED = 'true';
    process.env.AI_API_URL = 'https://ai.example.test/v1/generate';
    process.env.AI_API_KEY = 'integration-api-key';
    process.env.AI_MODEL = 'integration-template-mapper';
    process.env.HTML_TEMPLATE_AI_ORG_MINUTE_LIMIT = '10000';
    process.env.HTML_TEMPLATE_AI_ORG_DAILY_LIMIT = '10000';
    try {
      const [root] = await database
        .db!.select({ id: conferenceTemplates.id })
        .from(conferenceTemplates)
        .where(eq(conferenceTemplates.name, templateName))
        .limit(1);
      expect(root).toBeDefined();
      const detail = await service.documentDetail(DEMO_IDS.organization, root!.id);
      const titleNode = (detail.nodeManifest as Array<{ id: string; tagName: string }>).find(
        (node) => node.tagName === 'h1',
      );
      expect(titleNode).toBeDefined();
      const commandKey = `ai-mapping-${randomUUID()}`;
      const commandDigest = sha256Digest(JSON.stringify({ templateId: root!.id }));
      const first = await service.createAiMappingRun(
        DEMO_IDS.organization,
        root!.id,
        DEMO_IDS.adminUser,
        commandKey,
        commandDigest,
      );
      aiRunIds.push(first.id);

      await service.saveBindings(
        DEMO_IDS.organization,
        root!.id,
        DEMO_IDS.adminUser,
        detail.revision,
        {
          version: 1,
          bindings: [
            {
              id: 'ai-recovery-title',
              kind: 'text',
              nodeId: titleNode!.id,
              missingPolicy: 'error',
              segments: [{ kind: 'variable', path: 'event.name', format: 'plain' }],
            },
          ],
        },
      );

      const second = await service.createAiMappingRun(
        DEMO_IDS.organization,
        root!.id,
        DEMO_IDS.adminUser,
        commandKey,
        commandDigest,
      );
      expect(second.id).toBe(first.id);
      expect(second.baseRevision).toBe(first.baseRevision);
      expect(second.bindingDigest).toBe(first.bindingDigest);
      const persisted = await database
        .db!.select({ id: aiRuns.id })
        .from(aiRuns)
        .where(eq(aiRuns.id, first.id));
      expect(persisted).toEqual([{ id: first.id }]);
    } finally {
      for (const [name, value] of Object.entries({
        HTML_TEMPLATE_AI_MAPPING_ENABLED: previous.enabled,
        AI_API_URL: previous.apiUrl,
        AI_API_KEY: previous.apiKey,
        AI_MODEL: previous.model,
        HTML_TEMPLATE_AI_ORG_MINUTE_LIMIT: previous.minuteLimit,
        HTML_TEMPLATE_AI_ORG_DAILY_LIMIT: previous.dailyLimit,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('creates one quota reservation when an asset upload prepare is replayed', async () => {
    const previous = {
      endpoint: process.env.S3_PUBLIC_ENDPOINT,
      accessKey: process.env.S3_ACCESS_KEY,
      secretKey: process.env.S3_SECRET_KEY,
      bucket: process.env.S3_BUCKET,
    };
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
    process.env.S3_ACCESS_KEY = 'integration-access';
    process.env.S3_SECRET_KEY = 'integration-secret';
    process.env.S3_BUCKET = 'integration-bucket';
    try {
      const commandKey = `asset-upload-${randomUUID()}`;
      const input = {
        fileName: 'quota.png',
        mediaType: 'image/png',
        size: 67,
        contentDigest: 'a'.repeat(64),
        altText: '配额预留验收',
      };
      const first = await templateService.prepareAssetUpload(
        DEMO_IDS.organization,
        DEMO_IDS.adminUser,
        input,
        commandKey,
      );
      reservationStorageKeys.push(first.storageKey);
      await database
        .db!.update(templateAssetUploadReservations)
        .set({ expiresAt: new Date(Date.now() + 60_000) })
        .where(eq(templateAssetUploadReservations.storageKey, first.storageKey));
      const second = await templateService.prepareAssetUpload(
        DEMO_IDS.organization,
        DEMO_IDS.adminUser,
        input,
        commandKey,
      );
      expect(second.storageKey).toBe(first.storageKey);
      const reservations = await database
        .db!.select({
          storageKey: templateAssetUploadReservations.storageKey,
          expiresAt: templateAssetUploadReservations.expiresAt,
        })
        .from(templateAssetUploadReservations)
        .where(eq(templateAssetUploadReservations.storageKey, first.storageKey));
      expect(reservations).toHaveLength(1);
      expect(reservations[0]?.storageKey).toBe(first.storageKey);
      expect(reservations[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 11 * 60_000);
      expect(new Date(second.expiresAt).getTime()).toBeLessThan(
        reservations[0]!.expiresAt.getTime(),
      );
      await database
        .db!.update(templateAssetUploadReservations)
        .set({
          cleanupRequestedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        })
        .where(eq(templateAssetUploadReservations.storageKey, first.storageKey));
      await expect(
        templateService.prepareAssetUpload(
          DEMO_IDS.organization,
          DEMO_IDS.adminUser,
          input,
          commandKey,
        ),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      for (const [name, value] of Object.entries({
        S3_PUBLIC_ENDPOINT: previous.endpoint,
        S3_ACCESS_KEY: previous.accessKey,
        S3_SECRET_KEY: previous.secretKey,
        S3_BUCKET: previous.bucket,
      })) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('recovers one published template when save-as-template is replayed', async () => {
    const commandKey = `save-event-template-${randomUUID()}`;
    const input = {
      name: savedEventTemplateName,
      description: '验证大会另存模板的业务级恢复键。',
      tags: ['另存恢复'],
      includeContent: true,
    };
    const first = await templateService.saveEventAsTemplate(
      DEMO_IDS.organization,
      DEMO_IDS.event,
      DEMO_IDS.adminUser,
      input,
      commandKey,
    );
    const second = await templateService.saveEventAsTemplate(
      DEMO_IDS.organization,
      DEMO_IDS.event,
      DEMO_IDS.adminUser,
      input,
      commandKey,
    );

    expect(second.summary.id).toBe(first.summary.id);
    expect(second.summary.currentPublishedVersionId).toBeTruthy();
    const roots = await database
      .db!.select({ id: conferenceTemplates.id })
      .from(conferenceTemplates)
      .where(eq(conferenceTemplates.name, savedEventTemplateName));
    expect(roots).toEqual([{ id: first.summary.id }]);
  });

  it('queues scanning through the outbox and keeps cancellation terminal', async () => {
    const queued = await service.scanImport(
      DEMO_IDS.organization,
      scanImportId,
      DEMO_IDS.adminUser,
    );
    expect(queued).toMatchObject({ id: scanImportId, status: 'queued' });
    const [scanEvent] = await database
      .db!.select({
        eventType: outboxEvents.eventType,
        importId: sql<string>`${outboxEvents.payload}->>'importId'`,
      })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, DEMO_IDS.organization),
          eq(outboxEvents.eventType, 'TemplateHtmlImportScanRequested'),
          like(outboxEvents.correlationId, `%${scanImportId}%`),
        ),
      )
      .limit(1);
    expect(scanEvent).toEqual({
      eventType: 'TemplateHtmlImportScanRequested',
      importId: scanImportId,
    });

    await service.cancelImport(DEMO_IDS.organization, scanImportId, DEMO_IDS.adminUser);
    const [cleanupEvent] = await database
      .db!.select({ assetIds: sql<string[]>`${outboxEvents.payload}->'assetIds'` })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.organizationId, DEMO_IDS.organization),
          eq(outboxEvents.eventType, 'TemplateHtmlImportCleanupRequested'),
          like(outboxEvents.correlationId, `%${scanImportId}%`),
        ),
      )
      .limit(1);
    expect(cleanupEvent?.assetIds).toContain(leasedAssetId);
    const [persisted] = await database
      .db!.select({ status: templateHtmlImports.status })
      .from(templateHtmlImports)
      .where(eq(templateHtmlImports.id, scanImportId))
      .limit(1);
    expect(persisted?.status).toBe('expired');
  });

  it('prevents deletion of an asset referenced by an HTML document manifest', async () => {
    const [root] = await database
      .db!.select({ id: conferenceTemplates.id })
      .from(conferenceTemplates)
      .where(eq(conferenceTemplates.name, templateName))
      .limit(1);
    expect(root).toBeDefined();
    await database.db!.insert(templateAssets).values({
      id: assetId,
      organizationId: DEMO_IDS.organization,
      storageKey: `templates/${DEMO_IDS.organization}/${assetId}.png`,
      mediaType: 'image/png',
      size: 67,
      width: 1,
      height: 1,
      contentDigest: assetId.replaceAll('-', ''),
      altText: 'HTML 文档引用验收',
      createdBy: DEMO_IDS.adminUser,
    });
    await database
      .db!.update(templateHtmlDocuments)
      .set({
        assetManifest: [
          {
            assetId,
            targetUrl: `/api/v1/assets/templates/${assetId}`,
            storageKey: `templates/${DEMO_IDS.organization}/${assetId}.png`,
          },
        ],
      })
      .where(eq(templateHtmlDocuments.templateId, root!.id));

    await expect(
      templateService.deleteAsset(DEMO_IDS.organization, assetId, DEMO_IDS.adminUser),
    ).rejects.toMatchObject({ status: 409 });
    const [asset] = await database
      .db!.select({ id: templateAssets.id })
      .from(templateAssets)
      .where(eq(templateAssets.id, assetId))
      .limit(1);
    expect(asset?.id).toBe(assetId);
  });
});
