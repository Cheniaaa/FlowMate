import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const output = new URL('../.local/ui-evidence/', import.meta.url);
await mkdir(output, { recursive: true });
const results = [];
try {
  await expect.poll(() => fetch('http://127.0.0.1:5174/e2e/fixture.html')
    .then(response => response.status, () => 0), { timeout: 15000 }).toBe(200);
  for (const [width, height, label] of [[1440, 960, 'main'], [1000, 720, 'main'], [520, 720, 'quick']]) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:5174/e2e/fixture.html?window=${label}`);
    await expect(page.getByRole('heading', { name: '日常助理', exact: true })).toBeVisible();
    await expect(page.getByLabel('模型', { exact: true })).toHaveValue('00000000-0000-4000-8000-000000000002');
    await expect(page.getByRole('option', { name: /explicit-model/ })).toHaveCount(1);
    if (label === 'quick') {
      for (const name of ['新建会话', '在合成验收项目新建会话']) {
        await page.getByRole('button', { name: '打开项目导航' }).click();
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByRole('dialog', { name: '新建会话' })).toBeVisible();
        await page.getByRole('button', { name: '取消', exact: true }).click();
        await expect(page.getByRole('button', { name: '打开项目导航' })).toBeFocused();
      }
    }
    if (label === 'quick') await page.getByRole('button', { name: '打开项目导航' }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('新合成项目');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    if (label === 'quick') await page.getByRole('button', { name: '打开项目导航' }).click();
    await page.getByRole('button', { name: '在新合成项目新建会话', exact: true }).click();
    await page.getByLabel('新会话标题', { exact: true }).fill('新合成会话');
    await page.getByRole('button', { name: '创建会话', exact: true }).click();
    await expect(page.getByRole('heading', { name: '新合成会话', exact: true })).toBeVisible();
    await page.getByLabel('消息', { exact: true }).fill('合成用户消息');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('article', { name: '你的消息', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '停止当前运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toHaveCount(0);
    await page.getByLabel('消息', { exact: true }).fill('完成合成验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.evaluate(() => window.syntheticUi.complete());
    await expect(page.getByRole('article', { name: '日常助理的回复' })).toContainText('合成验收已完成');
    const notification = page.locator('[data-sonner-toast][data-type="success"]').first();
    await expect(notification).toHaveAttribute('data-mounted', 'true');
    await expect.poll(async () => {
      const rect = await notification.boundingBox();
      return !!rect && rect.y >= 12 && rect.x >= 12 && rect.x + rect.width <= width;
    }).toBe(true);
    await expect(page.getByRole('region', { name: '本次费用', exact: true })).toContainText('按用量计算');
    await page.getByLabel('消息', { exact: true }).fill('只属于本轮的失败输入');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    await page.evaluate(() => window.syntheticUi.fail('model_authentication_failed'));
    const failedInput = page.getByRole('article', { name: '你的消息', exact: true }).filter({ hasText: '只属于本轮的失败输入' });
    await expect(failedInput).toContainText('服务商拒绝了此连接的凭据');
    await expect(page.getByRole('article', { name: '你的消息', exact: true }).filter({ hasText: '合成用户消息' }).locator('.turn-error')).toHaveCount(0);
    await page.getByLabel('消息', { exact: true }).fill('故障后新草稿');
    await failedInput.getByRole('button', { name: '检查连接' }).click();
    await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests.filter(item => item.command === 'show_workbench').at(-1)?.args.target))
      .toEqual({ kind: 'connection', connection_id: '00000000-0000-4000-8000-000000000003' });
    if (label === 'main') {
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      await expect(settings.getByRole('combobox', { name: '编辑连接', exact: true })).toHaveValue('00000000-0000-4000-8000-000000000003');
      await settings.getByRole('button', { name: '模型设置', exact: true }).click();
      await settings.getByRole('button', { name: '更多模型', exact: true }).click();
      await settings.getByRole('button', { name: /explicit-model/ }).click();
      await expect(settings.getByText('价格未知：合成价格未知；不代表免费')).toBeVisible();
      await settings.getByRole('button', { name: '关闭设置' }).click();
    }
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('故障后新草稿');
    await page.getByLabel('消息', { exact: true }).fill('缺凭据待恢复的原输入');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    await page.evaluate(() => window.syntheticUi.fail('credential_missing'));
    if (label === 'main') {
      await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await expect(page.getByLabel('消息', { exact: true })).toBeFocused();
    }
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('缺凭据待恢复的原输入');
    const attachmentStart = await page.evaluate(() => window.syntheticUi.requests.length);
    await page.getByRole('button', { name: '选择文本文件', exact: true }).click();
    await expect(page.getByText(/点击发送即同意本次读取/)).toContainText('https://example.invalid/v1');
    await page.getByLabel('消息', { exact: true }).fill('本次附件发送意图');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    const attachmentWrites = await page.evaluate(start => window.syntheticUi.requests.slice(start)
      .filter(item => item.method === 'POST' && (item.path === '/grants' || item.path.endsWith('/runs'))), attachmentStart);
    expect(attachmentWrites).toHaveLength(2);
    expect(attachmentWrites[0]).toMatchObject({ path: '/grants', body: { data: {
      purposes: ['read', 'model_send'], destination: 'https://example.invalid/v1', resource_ids: ['00000000-0000-4000-8000-000000000010'],
    } } });
    expect(attachmentWrites[1].body.data).toMatchObject({ text: '本次附件发送意图', sources: { resource_ids: ['00000000-0000-4000-8000-000000000010'] } });
    await expect(page.getByRole('button', { name: '重试状态同步', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '停止当前运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^结果/ }).click();
    await expect(page.getByRole('dialog', { name: '后台交付结果' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^结果/ })).toBeFocused();
    await page.getByLabel('消息', { exact: true }).fill('保留中的草稿');
    if (label === 'main') {
      await page.getByRole('button', { name: '模型设置', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
      await page.getByLabel('搜索连接', { exact: true }).dispatchEvent('compositionstart');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
      await page.getByLabel('搜索连接', { exact: true }).dispatchEvent('compositionend');
      await page.getByRole('button', { name: '关闭设置' }).click();
      await expect(page.getByRole('button', { name: '模型设置', exact: true })).toBeFocused();
    }
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留中的草稿');
    if (label === 'quick') {
      await page.getByRole('button', { name: '打开项目导航' }).click();
      await page.getByRole('button', { name: '合成对照会话', exact: true }).click();
      await expect(page.getByRole('heading', { name: '合成对照会话', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '打开项目导航' })).toBeFocused();
      await page.getByRole('button', { name: '打开项目导航' }).click();
      await page.getByRole('button', { name: '新合成会话', exact: true }).click();
      await expect(page.getByRole('heading', { name: '新合成会话', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '打开项目导航' })).toBeFocused();
      await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留中的草稿');
      const expand = page.getByRole('button', { name: '展开工作台', exact: true });
      const hide = page.getByRole('button', { name: '隐藏快捷小窗', exact: true });
      const receipt = Promise.withResolvers();
      await page.exposeFunction('acknowledgeWorkbench', () => receipt.promise);
      const sent = () => page.evaluate(() => window.syntheticUi.nativeRequests.filter(item => item.command === 'show_workbench').length);
      const before = await sent();
      await expand.click();
      await expect(hide).toBeDisabled();
      await expect(expand).toBeFocused();
      await page.keyboard.press('Enter');
      expect(await sent()).toBe(before + 1);
      receipt.resolve();
      await expect(hide).toBeEnabled();
      await expect(expand).toBeFocused();
    }
    const geometry = await page.evaluate(() => {
      const composer = document.querySelector('.composer').getBoundingClientRect();
      const user = document.querySelector('.message--user').getBoundingClientRect();
      const thread = document.querySelector('.thread').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, composerVisible: composer.bottom <= innerHeight, userRight: Math.abs(user.right - thread.right) < 2 };
    });
    expect(geometry).toEqual({ overflow: false, composerVisible: true, userRight: true });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
    await page.screenshot({ path: new URL(`${label}-${width}x${height}.png`, output).pathname.replace(/^\/([A-Z]:)/, '$1') });
    results.push({ width, height, label, geometry, errors, checks: ['send', 'stop', 'completion', 'failure-connection', 'credential-draft', 'attachment-consent', 'cost', 'sidebar', 'sheet-focus', 'draft', 'default-model-tail',
      ...(label === 'main' ? ['automatic-settings-return-focus', 'explicit-settings-return-focus', 'synthetic-ime'] : ['session-cancel-focus', 'session-navigation-focus', 'expand-workbench-focus'])],
      requests: await page.evaluate(() => window.syntheticUi.requests.length) });
    await context.close();
  }
  await writeFile(new URL('results.json', output), JSON.stringify({ browser: browser.version(), results }, null, 2));
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally { await browser.close(); }
