import { chromium } from 'playwright-core';

const adminBase = process.env.ADMIN_BASE_URL ?? 'http://admin.localhost:8088/admin';
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminUsername || !adminPassword) {
  throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required for the admin upgrade test');
}
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForAutosave(page) {
  await page.waitForFunction(
    () => document.querySelector('.save-state')?.textContent?.includes('保存中'),
    undefined,
    { timeout: 5_000 },
  );
  try {
    await page.waitForFunction(
      () => document.querySelector('.save-state')?.textContent?.includes('已保存'),
      undefined,
      { timeout: 10_000 },
    );
  } catch {
    const diagnostic = await page.evaluate(() => ({
      saveState: document.querySelector('.save-state')?.textContent?.trim(),
      error: document.querySelector('.admin-error')?.textContent?.trim(),
    }));
    throw new Error(`Template autosave did not finish: ${JSON.stringify(diagnostic)}`);
  }
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  await page.goto(`${adminBase}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel('用户名').fill(adminUsername);
  await page.getByLabel('密码').fill(adminPassword);
  await page.getByRole('button', { name: '进入运营台' }).click();
  await page.waitForURL(/\/manage\/events/);

  await page.getByRole('button', { name: '创建大会' }).click();
  await page.locator('#event-timezone').waitFor();
  assert(
    (await page.locator('#event-timezone').inputValue()) === 'Asia/Shanghai',
    '大会创建流程没有带入组织默认时区',
  );
  assert(
    await page.getByText('开始与结束时间会按此时区保存和发布。').isVisible(),
    '大会创建流程缺少时区说明',
  );
  await page.getByRole('button', { name: '返回大会列表' }).click();

  await page.goto(`${adminBase}/manage/templates`, { waitUntil: 'networkidle' });
  await page
    .getByRole('button', { name: /编辑草稿|查看模板/ })
    .first()
    .click();
  await page.waitForURL(/\/manage\/templates\/[^/]+$/);
  await page.getByRole('button', { name: /^首页/ }).click();
  const titleInput = page.locator('.template-property-panel input').first();
  const originalTitle = await titleInput.inputValue();
  const markerTitle = `${originalTitle || '大会首页'} · 自动保存验证`;
  await titleInput.fill(markerTitle);
  await waitForAutosave(page);

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^首页/ }).click();
  assert(
    (await page.locator('.template-property-panel input').first().inputValue()) === markerTitle,
    '模板自动保存后重新载入未保留修改',
  );
  await page.locator('.template-property-panel input').first().fill(originalTitle);
  await waitForAutosave(page);

  console.log(
    JSON.stringify(
      {
        ok: true,
        eventCreationTimezone: 'Asia/Shanghai',
        templateAutosave: 'persisted and restored',
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
