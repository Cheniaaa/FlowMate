import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const usageTitle = /^会话用量与费用$/;

export async function checkSessionContext(page, origin, label, width, capture = async () => {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(new URL(`/e2e/fixture.html?window=${label}&reading=context-current`, origin).href, {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  const thread = page.getByRole('region', { name: '持久对话' });
  const entry = page.locator('nav.conversation-detail-rail').getByRole('button', { name: '上下文', exact: true });
  const detail = page.getByRole(label === 'main' && width >= 1000 ? 'complementary' : 'dialog', { name: '上下文', exact: true });
  const sources = detail.getByRole('region', { name: '本轮来源', exact: true });
  const disclosure = title => detail.locator('details').filter({
    has: page.locator('summary').filter({ hasText: title }),
  });
  const requests = disclosure(/^(?:本轮)?模型请求/);
  const usage = disclosure(usageTitle);
  const traffic = () => page.evaluate(() => window.syntheticUi.requests.filter(request =>
    /\/context(?:\/usage)?$/.test(request.path)));
  const usageCount = async () => (await traffic()).filter(item => item.path.endsWith('/context/usage')).length;
  const history = '4 条历史消息不在本轮资料范围';
  await expect(thread.locator('article.message')).toHaveCount(4);
  await expect(thread.getByText(history, { exact: true })).toHaveCount(0);
  await expect(thread.getByRole('list', { name: '已发送的附件', exact: true })).toHaveText('读书会纪要.txt');
  await expect(detail).toHaveCount(0);
  await expect(entry).toHaveAttribute('aria-pressed', 'false');
  expect(await traffic()).toEqual([]);

  await entry.press('Enter');
  await expect(sources).toContainText('读书会纪要.txt');
  await expect(sources).toContainText('继承自本会话');
  await expect(sources).toContainText('已读 15 字符 · 区间 [0, 15) / 716');
  await expect(sources.getByText('检查文件', { exact: true })).toHaveCount(0);
  const latest = detail.getByRole('region', { name: '最近一次模型请求', exact: true });
  const capacity = latest.getByRole('meter', { name: '输入容量占比', exact: true });
  await expect(capacity).toHaveAttribute('max', '96000');
  await expect(capacity).toHaveAttribute('value', '11620');
  await expect(latest.getByText('11,620 / 96,000 tokens', { exact: true })).toBeVisible();
  await expect(latest.getByText('12.1%', { exact: true })).toBeVisible();
  await expect(latest.getByText('83.7%', { exact: true })).toBeVisible();
  await expect(latest.getByText('11,620 tokens', { exact: true })).toBeVisible();
  await expect(latest.getByText('526 tokens', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: /^(上一轮|下一轮|跟随最新)$/ })).toHaveCount(0);
  await expect(requests).not.toHaveAttribute('open', '');
  await expect(usage).not.toHaveAttribute('open', '');
  expect(await usageCount()).toBe(0);
  await capture('sources', page);

  await sources.getByText(history, { exact: true }).click();
  await expect(sources.getByText('不在本次资料范围：4 条', { exact: true })).toBeVisible();
  await sources.getByText(history, { exact: true }).click();
  await requests.locator('summary').press('Enter');
  const request = number => requests.locator('li').filter({ hasText: `第 ${number} 次请求` });
  const fact = (item, name) => item.getByText(name, { exact: true }).locator('xpath=following-sibling::dd[1]');
  await expect(fact(request(1), '输入缓存')).toHaveText('命中 · 9,728 tokens');
  await expect(fact(request(2), '输入缓存')).toHaveText('无缓存读数');
  await expect(request(2)).toContainText('输入容量未确认');
  await expect(request(2).getByRole('meter')).toHaveCount(0);
  await expect(request(5)).toHaveCount(0);
  expect(await usageCount()).toBe(0);

  await detail.getByRole('button', { name: '更多本轮记录', exact: true }).click();
  await expect(fact(request(3), '输入缓存')).toHaveText('未命中 · 0 tokens');
  await expect(fact(request(5), '费用')).toHaveText('未确认');
  expect((await traffic()).some(item => item.path.endsWith('/context') && item.query.cursor)).toBe(true);
  expect(await usageCount()).toBe(0);
  await capture('requests', page);

  await requests.locator('summary').press('Enter');
  await usage.locator('summary').press('Enter');
  await expect(usage).toContainText('19,456 tokens · 3/8 次已报告');
  await expect(usage).toContainText('53.4%');
  await expect(usage).toContainText('$0.093215');
  await expect(usage).toContainText('1 次费用未确认');
  expect(await usageCount()).toBe(1);
  await capture('usage', page);
  await usage.locator('summary').press('Enter');
  await expect(usage.getByText('$0.093215', { exact: true })).toHaveCount(0);

  await page.evaluate(() => window.syntheticUi.receiveContextReply());
  await expect(page.getByText('白板已确认，使用后请擦干净。', { exact: true })).toBeAttached();
  await expect(sources).toContainText('本轮没有固定文件');
  await expect(sources.getByText('读书会纪要.txt', { exact: true })).toHaveCount(0);
  await expect(capacity).toHaveAttribute('max', '16000');
  await expect(capacity).toHaveAttribute('value', '3100');
  expect(await usageCount()).toBe(1);
  expect((await traffic()).every(item => !('run_id' in item.query))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(entry).toBeFocused();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174';
  const output = process.argv[2];
  if (!output) throw new Error('请提供截图输出目录');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, width, colorScheme] of [
      ['main', 1000, 'light'], ['main', 520, 'light'], ['quick', 520, 'light'], ['quick', 520, 'dark'],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 720 }, colorScheme });
      await page.addInitScript(theme => localStorage.setItem('flowmate:theme', theme), colorScheme);
      try {
        await checkSessionContext(page, origin, label, width, async (state, page) => {
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({ path: join(output, `context-${label}-${width}-${colorScheme}-${state}.png`), animations: 'disabled' });
        });
        console.log(`[通过] ${label} ${width} ${colorScheme}`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
}
