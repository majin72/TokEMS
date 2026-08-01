import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function redactVisualDiagnostic(value) {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[redacted-mobile]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/giu, '$1[redacted-token]')
    .replace(
      /(\b(?:access[_-]?token|refresh[_-]?token|device[_-]?token|token|secret|password|passcode|otp|code|api[_-]?key|payment[_-]?key|session(?:[_-]?id)?|cookie|csrf)\b["']?\s*[:=]\s*["']?)[^"'\s&,}]+/giu,
      '$1[redacted]',
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '[redacted-value]');
}

function diagnosticUrl(value) {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return redactVisualDiagnostic(value);
  }
}

async function pageSummary(page) {
  try {
    return await page.evaluate(() => {
      const active = document.activeElement;
      return {
        bodyClass: document.body?.className ?? '',
        activeElement: active
          ? {
              tag: active.tagName,
              id: active.id,
              className: typeof active.className === 'string' ? active.className : '',
            }
          : null,
        counts: {
          dialogs: document.querySelectorAll('dialog[open]').length,
          buttons: document.querySelectorAll('button').length,
          forms: document.querySelectorAll('form').length,
          tables: document.querySelectorAll('table').length,
        },
      };
    });
  } catch (error) {
    return { unavailable: redactVisualDiagnostic(error instanceof Error ? error.message : error) };
  }
}

export async function captureVisualFailure({ browser, output, error }) {
  await mkdir(output, { recursive: true });
  const pages = browser?.contexts().flatMap((context) => context.pages()) ?? [];
  const diagnostics = [];
  for (const [index, page] of pages.entries()) {
    const screenshot = `failure-page-${index + 1}.png`;
    try {
      await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
    } catch {
      // The page can disappear while Playwright is collecting failure evidence.
    }
    diagnostics.push({
      url: diagnosticUrl(page.url()),
      title: redactVisualDiagnostic(await page.title().catch(() => '')),
      screenshot,
      dom: await pageSummary(page),
    });
  }
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const report = {
    error: {
      name: normalizedError.name,
      message: redactVisualDiagnostic(normalizedError.message),
      stack: redactVisualDiagnostic(normalizedError.stack ?? ''),
    },
    pages: diagnostics,
  };
  await writeFile(resolve(output, 'failure.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
