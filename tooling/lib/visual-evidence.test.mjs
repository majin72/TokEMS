import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureVisualFailure, redactVisualDiagnostic } from './visual-evidence.mjs';

test('QA-04 visual failures save screenshots, URLs and redacted DOM summaries', async () => {
  const output = await mkdtemp(join(tmpdir(), 'tokems-visual-evidence-'));
  const screenshots = [];
  const page = {
    url: () => 'https://admin.example.com/admin/manage/users?token=secret-value',
    title: async () => '用户管理',
    evaluate: async () => ({
      bodyClass: 'admin-body',
      activeElement: { tag: 'BUTTON', id: '', className: 'button danger' },
      counts: { dialogs: 1, buttons: 8, forms: 0, tables: 1 },
    }),
    screenshot: async ({ path }) => screenshots.push(path),
  };
  const browser = { contexts: () => [{ pages: () => [page] }] };

  const report = await captureVisualFailure({
    browser,
    output,
    error: new Error('删除用户 13800138000 user@example.com token=secret-value'),
  });

  assert.equal(screenshots.length, 1);
  assert.equal(report.pages[0].url, 'https://admin.example.com/admin/manage/users');
  assert.equal(report.pages[0].dom.counts.dialogs, 1);
  assert.doesNotMatch(report.error.message, /13800138000|user@example\.com|secret-value/u);
  const saved = JSON.parse(await readFile(join(output, 'failure.json'), 'utf8'));
  assert.deepEqual(saved, report);
});

test('visual console diagnostics redact secrets and personal identifiers before logging', () => {
  const diagnostic = redactVisualDiagnostic(
    'HTTP 500 https://example.com/orders?access_token=short-secret mobile=13800138000 '
      + '{"password":"visible-password"} Cookie: session=visible-session',
  );

  assert.doesNotMatch(
    diagnostic,
    /short-secret|13800138000|visible-password|visible-session/u,
  );
});
