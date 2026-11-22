import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = new URL('/e2e/fixture.html', process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174');
const archive = fileURLToPath(new URL('../.local/ui-evidence/', import.meta.url));
await mkdir(archive, { recursive: true });
const output = await mkdtemp(join(archive, 'task3-management-'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function run(name, width, check, windowLabel = 'main') {
  const context = await browser.newContext({ viewport: { width, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(new URL(`?window=${windowLabel}`, fixture).href);
    await expect(page.getByRole('heading', { name: '日常助理', exact: true })).toBeVisible();
    await check(page, label => page.screenshot({ path: join(output, `${name}-${label}.png`) }), windowLabel);
    expect(errors).toEqual([]);
    return { name, width, window: windowLabel, passed: true };
  } catch (error) {
    const focus = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 350));
    await page.screenshot({ path: join(output, `${name}-failed.png`) });
    return { name, width, window: windowLabel, passed: false, error: String(error), focus, pageErrors: errors };
  } finally {
    await context.close();
  }
}

async function checkOverwrite(page, screenshot, windowLabel) {
  const trigger = page.getByRole('button', { name: '选择 Skill', exact: true });
  await trigger.press('Enter');
  const library = page.getByRole(windowLabel === 'quick' ? 'dialog' : 'region', { name: '能力库', exact: true });
  await library.getByLabel('能力范围').selectOption('workspace');
  const exportButton = library.getByRole('button', { name: '导出标准包', exact: true });
  const dialog = page.getByRole('dialog', { name: '确认覆盖', exact: true });
  const cancel = dialog.getByRole('button', { name: '取消覆盖' });
  const confirm = dialog.getByRole('button', { name: '确认覆盖并保存' });
  const writes = () => page.evaluate(() => window.syntheticUi.requests.filter(
    request => request.method === 'POST' && request.path === '/capabilities/skill-exports'));
  await page.evaluate(() => {
    const originalInvoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (...args) => {
      const result = await originalInvoke(...args);
      if (args[0] === 'choose_skill_export_target' && !window.task3PickerReady) {
        await new Promise(resolve => {
          window.addEventListener('release-task3-picker', resolve, { once: true });
          window.task3PickerReady = true;
        });
      }
      return result;
    };
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (init?.method === 'POST' && new URL(String(input)).pathname === '/v3/capabilities/skill-exports') {
        await new Promise(resolve => {
          window.addEventListener('release-task3-save', resolve, { once: true });
          window.task3SaveReady = true;
        });
      }
      return originalFetch(input, init);
    };
  });
  for (const action of ['Escape', '取消覆盖', '确认覆盖并保存']) {
    await exportButton.press('Enter');
    if (action === 'Escape') {
      await page.waitForFunction(() => window.task3PickerReady);
      await expect(dialog).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(library).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('release-task3-picker')));
    }
    await expect(dialog).toContainText('已有的发布说明.zip');
    await expect(cancel).toBeFocused();
    if (action === 'Escape') {
      const bounds = await dialog.boundingBox();
      const { width, height } = page.viewportSize();
      expect(Math.abs(bounds.x + bounds.width / 2 - width / 2)).toBeLessThan(2);
      expect(Math.abs(bounds.y + bounds.height / 2 - height / 2)).toBeLessThan(2);
      await screenshot('dialog');
      await page.keyboard.press('Escape');
    } else if (action === '取消覆盖') await cancel.press('Enter');
    else {
      await confirm.press('Enter');
      await page.waitForFunction(() => window.task3SaveReady);
      await expect(confirm).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      expect(await writes()).toHaveLength(0);
      await page.evaluate(() => window.dispatchEvent(new Event('release-task3-save')));
    }
    await expect(dialog).toHaveCount(0);
    await expect(library).toBeVisible();
    await expect(exportButton).toBeFocused();
    expect(await writes()).toHaveLength(action === '确认覆盖并保存' ? 1 : 0);
  }
  const [write] = await writes();
  expect(write.body).toMatchObject({
    meta: { command_id: expect.any(String) },
    data: { confirmed_target_hash: 'c'.repeat(64), content_hash: 'a'.repeat(64) },
  });
  await page.keyboard.press('Escape');
  await expect(library).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function checkReturn(page, screenshot, destination, viaDrawer) {
  const draft = page.getByRole('textbox', { name: '消息', exact: true });
  await draft.fill('返回工作台后继续编辑的草稿');
  const navigation = page.getByRole('button', { name: '打开项目导航' });
  if (viaDrawer) await navigation.press('Enter');
  const entry = page.getByRole('complementary', { name: '项目导航', exact: true })
    .getByRole('button', { name: destination, exact: true });
  const original = await entry.elementHandle();
  await entry.press('Enter');
  const panel = page.getByRole(destination === '设置' ? 'dialog' : 'region', { name: destination, exact: true });
  await expect(panel).toBeVisible();
  if (viaDrawer) {
    expect(await original.evaluate(node => node.isConnected)).toBe(false);
    await expect(page.locator('.sidebar-sheet')).toHaveCount(0);
  }
  const close = panel.getByRole('button', { name: destination === '设置' ? '关闭设置' : '返回对话与草稿', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(viaDrawer ? navigation : entry).toBeFocused();
  await expect(draft).toHaveValue('返回工作台后继续编辑的草稿');
  await screenshot('return');
}

async function checkPreserveFocus(page) {
  await page.getByRole('button', { name: '记忆与成长', exact: true }).press('Enter');
  const memory = page.getByRole('region', { name: '记忆与成长', exact: true });
  await expect(memory).toBeVisible();
  // 模拟工作台之外的控件已接管焦点，页面随后接到关闭事件。
  await page.evaluate(() => {
    const next = document.createElement('button');
    next.textContent = '已取得焦点的控件';
    document.body.append(next);
    next.focus();
  });
  const outside = page.getByRole('button', { name: '已取得焦点的控件', exact: true });
  await expect(outside).toBeFocused();
  await memory.getByRole('button', { name: '返回对话与草稿', exact: true }).dispatchEvent('click');
  await expect(memory).toHaveCount(0);
  await expect(outside).toBeFocused();
}

async function checkDeferredExport(page, screenshot) {
  await page.evaluate(() => {
    const fetchFixture = window.fetch;
    window.task3Attempts = [];
    window.task3Lookups = [];
    const reply = (code, status) => Response.json({
      error: { code, safe_message: code, related_ids: [], retryable: false },
    }, { status });
    window.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v3/capabilities/skill-exports' && init?.method === 'POST') {
        window.task3Attempts.push(String(init.body));
        if (window.task3Attempts.length === 1) throw new TypeError('首次请求未到达 Runtime');
        return reply('skill_version_missing', 409);
      }
      if (url.pathname.startsWith('/v3/capabilities/skill-exports/')) {
        window.task3Lookups.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
        return reply('skill_export_not_found', 404);
      }
      const response = await fetchFixture(input, init);
      if (url.pathname === '/v3/capabilities/skills' && window.task3Attempts.length) {
        return Response.json({ ...await response.json(), items: [] });
      }
      return response;
    };
  });
  const message = page.getByRole('textbox', { name: '消息', exact: true });
  await message.fill('稍后核对后继续处理的草稿');
  const open = page.getByRole('button', { name: '选择 Skill', exact: true });
  const library = page.getByRole('region', { name: '能力库', exact: true });
  await open.press('Enter');
  await library.getByLabel('能力范围').selectOption('workspace');
  await library.getByRole('button', { name: '导出标准包' }).press('Enter');
  await page.getByRole('button', { name: '确认覆盖并保存' }).press('Enter');
  const pending = page.getByRole('region', { name: '保存结果待确认' });
  await expect(pending.getByRole('button', { name: '重试保存' })).toBeEnabled();
  await pending.getByRole('button', { name: '重试保存' }).press('Enter');
  await expect(library.getByRole('alert')).toContainText('本次重试未完成');
  await expect(pending.getByRole('button', { name: '查询保存结果' })).toBeEnabled();
  await pending.getByRole('button', { name: '查询保存结果' }).press('Enter');
  await expect(library.getByRole('alert')).toContainText('暂未找到');
  const defer = pending.getByRole('button', { name: '暂缓核对并返回草稿' });
  await defer.scrollIntoViewIfNeeded();
  await expect(defer).toBeInViewport();
  await screenshot('pending');
  await defer.press('Enter');
  await expect(library).toHaveCount(0);
  await expect(message).toHaveValue('稍后核对后继续处理的草稿');
  await open.press('Enter');
  await expect(library.getByText('没有匹配的 Skill。')).toBeVisible();
  await library.getByRole('button', { name: '保存记录与恢复' }).press('Enter');
  const deferred = library.getByRole('article', { name: '已有的发布说明.zip' });
  await expect(deferred).toContainText('保存结果待核对');
  await library.getByLabel('能力范围').selectOption('user_global');
  await expect(deferred).toHaveCount(0);
  await library.getByLabel('能力范围').selectOption('workspace');
  await expect(deferred).toBeVisible();
  await expect(deferred.getByRole('button', { name: '查询保存结果' })).toBeInViewport();
  await screenshot('recovery');
  await deferred.getByRole('button', { name: '查询保存结果' }).press('Enter');
  await expect(deferred.getByRole('alert')).toContainText('暂未找到');
  await deferred.getByRole('button', { name: '重试保存' }).press('Enter');
  await expect(deferred.getByRole('alert')).toContainText('本次重试未完成');
  const { attempts, lookups, nativeRequests } = await page.evaluate(() => ({
    attempts: window.task3Attempts, lookups: window.task3Lookups, nativeRequests: window.syntheticUi.nativeRequests,
  }));
  expect(attempts).toEqual([attempts[0], attempts[0], attempts[0]]);
  const original = JSON.parse(attempts[0]);
  expect(original.data).toMatchObject({ confirmed_target_hash: 'c'.repeat(64), content_hash: 'a'.repeat(64) });
  expect(lookups).toEqual(Array(2).fill({
    path: `/v3/capabilities/skill-exports/${original.meta.command_id}`,
    query: { scope_kind: 'workspace', workspace_id: original.data.scope.workspace_id },
  }));
  expect(nativeRequests.filter(request => request.command === 'choose_skill_export_target')).toHaveLength(1);
  await library.getByRole('button', { name: '返回对话与草稿' }).press('Enter');
  await expect(message).toHaveValue('稍后核对后继续处理的草稿');
  await page.reload();
  await open.press('Enter');
  await library.getByLabel('能力范围').selectOption('workspace');
  await library.getByRole('button', { name: '保存记录与恢复' }).press('Enter');
  await expect(deferred).toContainText('保存结果待核对');
}

try {
  const results = await Promise.all([
    run('overwrite-main', 520, checkOverwrite),
    run('overwrite-quick', 520, checkOverwrite, 'quick'),
    run('drawer-memory', 520, (page, shot) => checkReturn(page, shot, '记忆与成长', true)),
    run('drawer-assistants', 520, (page, shot) => checkReturn(page, shot, '我的助理', true)),
    run('wide-memory', 1000, (page, shot) => checkReturn(page, shot, '记忆与成长', false)),
    run('wide-assistants', 1000, (page, shot) => checkReturn(page, shot, '我的助理', false)),
    run('wide-settings', 1000, (page, shot) => checkReturn(page, shot, '设置', false)),
    run('preserve-focus', 1000, checkPreserveFocus),
    run('deferred-export', 520, checkDeferredExport),
  ]);
  await writeFile(join(output, 'results.json'), JSON.stringify({ browser: browser.version(), results }, null, 2));
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  console.log(output);
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally {
  await browser.close();
}
