import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('请指定 before 或 after');
const output = fileURLToPath(new URL('../.local/ui-evidence/conversation-hierarchy/', import.meta.url));
await mkdir(output, { recursive: true });
const origin = process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];

async function measure(locator) {
  return locator.evaluate(node => {
    const style = getComputedStyle(node);
    let background = 'rgb(255, 255, 255)';
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      const color = getComputedStyle(ancestor).backgroundColor;
      if (color.startsWith('rgb(')) {
        background = color;
        break;
      }
    }
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(channel => Number(channel) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const { fontSize, lineHeight, fontWeight, color, listStyleType, listStylePosition,
      paddingInlineStart, marginBlockStart, marginBlockEnd, borderBlockEndWidth, borderInlineStartWidth, outlineColor, outlineWidth } = style;
    const contrast = (foreground, backdrop) => {
      const [darker, lighter] = [luminance(foreground), luminance(backdrop)].sort((a, b) => a - b);
      return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
    };
    return { fontSize, lineHeight, fontWeight, color, background, contrast: contrast(color, background),
      listStyleType, listStylePosition, paddingInlineStart, marginBlockStart, marginBlockEnd,
      borderBlockEndWidth, borderInlineStartWidth, outlineColor, outlineWidth, outlineContrast: contrast(outlineColor, background) };
  });
}

try {
  for (const [windowLabel, width, height] of [['main', 1000, 720], ['quick', 520, 720], ['main', 1440, 960]]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme,
        permissions: ['clipboard-read', 'clipboard-write'] });
      const prefix = `${phase}-${windowLabel}-${width}x${height}-${theme}`;
      await page.addInitScript(value => localStorage.setItem('flowmate:theme', value), theme);
      await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&reading=hierarchy`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const transcript = page.getByRole('region', { name: '持久对话' });
      const heading = transcript.getByRole('heading', { name: '阅读会准备简报' });
      await expect(heading).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const answer = heading.locator('..');
      const block = answer.locator('pre').filter({ has: page.locator('code.language-toml') });
      const sourceCode = await block.locator('code').textContent();
      expect(sourceCode).toContain('\n    room = "302"\n');
      expect(sourceCode).toMatch(/"南京项目组"\]\n$/);
      await answer.getByRole('button', { name: '复制 toml 代码' }).click();
      await expect(answer.getByRole('status', { exact: true }).filter({ hasText: '已复制' })).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied.replaceAll('\r\n', '\n')).toBe(sourceCode);
      const localScroll = await block.evaluate(node => {
        node.scrollLeft = node.scrollWidth;
        return node.scrollLeft;
      });
      expect(localScroll, '长代码行在代码块内横向滚动').toBeGreaterThan(0);
      await expect(answer.getByRole('cell', { name: '屏幕共享' })).toBeVisible();
      const activity = transcript.locator('.activity-group');
      const delivery = transcript.getByRole('article', { name: '后台交付' });
      const managed = transcript.getByLabel('后台任务条');
      const deliveryAction = delivery.getByRole('button', { name: '查看交付结果' });
      await expect(deliveryAction).toBeEnabled();
      await expect(managed.getByRole('button', { name: '查看后台任务' })).toBeEnabled();
      await transcript.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: join(output, `${prefix}.png`) });
      await deliveryAction.scrollIntoViewIfNeeded();
      await managed.scrollIntoViewIfNeeded();
      await expect(deliveryAction).toBeInViewport();
      await expect(managed).toBeInViewport();
      await page.screenshot({ path: join(output, `${prefix}-delivery.png`) });

      await activity.locator(':scope > summary').press('Enter');
      const reasoning = transcript.locator('.reasoning');
      await reasoning.locator('summary').press('Enter');
      const tool = activity.locator('.tool-card').last();
      await tool.locator('summary').press('Enter');
      await expect(tool.getByText('设备清单：白板、投影。')).toBeVisible();
      await transcript.evaluate(node => { node.scrollTop = 0; });
      await page.screenshot({ path: join(output, `${prefix}-expanded.png`) });
      const samples = {
        user: transcript.locator('.message--user p'),
        body: answer.locator(':scope > p'),
        strong: answer.locator(':scope > p strong'),
        h1: heading,
        h2: answer.locator('h2'),
        h3: answer.locator('h3'),
        ul: answer.locator(':scope > ul'),
        nestedList: answer.locator('li ul'),
        nestedText: answer.locator('li ul li'),
        ol: answer.locator('ol'),
        quote: answer.locator('blockquote'),
        quoteBody: answer.locator('blockquote p'),
        activity: activity.locator(':scope > summary'),
        activityGroup: activity,
        reasoning: reasoning.locator('p'),
        tool: tool.getByText('设备清单：白板、投影。', { exact: true }),
        focusedTool: tool.locator('summary'),
        deliveryLabel: delivery.locator('.message-author'),
        deliveryBody: delivery.locator('p'),
        deliveryAction,
        managedLabel: managed.locator('strong'),
        managedStatus: managed.locator('.status'),
        managedAction: managed.getByRole('button', { name: '查看后台任务' }),
      };
      const computed = Object.fromEntries(await Promise.all(Object.entries(samples).map(async ([key, node]) => [key, await measure(node)])));
      expect(await transcript.evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true);

      await deliveryAction.click();
      const inbox = page.getByRole('heading', { name: '后台交付结果' });
      await expect(inbox).toBeVisible();

      await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&reading=hierarchy`);
      const composer = page.getByLabel('消息', { exact: true });
      await composer.fill('是否需要提前布置会场？');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(transcript.getByText('是否需要提前布置会场？')).toBeVisible();
      await page.evaluate(() => window.syntheticUi.readingPreview());
      const streamed = transcript.getByLabel('未提交预览').locator('p');
      await expect(streamed).toBeVisible();
      computed.stream = await measure(streamed);
      computed.liveStatus = await measure(transcript.getByRole('region', { name: '本轮活动' }).locator('.status'));
      results.push({ windowLabel, width, height, theme, computed });
      await page.close();
    }
  }
  if (phase === 'after') for (const { computed: c } of results) {
    for (const key of ['user', 'body', 'strong', 'nestedText', 'quoteBody', 'stream']) {
      expect(c[key], key).toMatchObject({ fontSize: '14px', lineHeight: '21.7px' });
    }
    expect(c.deliveryBody).toMatchObject({ fontSize: '13px', lineHeight: '19.5px' });
    for (const [key, size] of [['h1', 17], ['h2', 15], ['h3', 14]]) {
      expect(c[key], key).toMatchObject({ fontSize: `${size}px`, fontWeight: '700' });
      expect(parseFloat(c[key].marginBlockEnd)).toBeGreaterThan(0);
    }
    expect(c.strong.fontWeight).toBe('700');
    expect(c.h1.marginBlockStart).toBe('0px');
    expect(c.h2.marginBlockStart).toBe('10px');
    expect(c.h3.marginBlockStart).toBe('10px');
    for (const [key, style] of [['ul', 'disc'], ['nestedList', 'circle'], ['ol', 'decimal']]) {
      expect(c[key], key).toMatchObject({ listStyleType: style, listStylePosition: 'outside' });
      expect(parseFloat(c[key].paddingInlineStart)).toBeGreaterThanOrEqual(18);
    }
    expect(c.quote).toMatchObject({ borderInlineStartWidth: '2px', paddingInlineStart: '10px' });
    expect(c.activityGroup.borderBlockEndWidth).toBe('1px');
    expect(c.focusedTool.outlineWidth).toBe('2px');
    expect(c.focusedTool.outlineContrast).toBeGreaterThanOrEqual(3);
    for (const key of ['activity', 'reasoning', 'tool', 'deliveryLabel', 'deliveryBody', 'deliveryAction', 'managedLabel', 'managedStatus', 'managedAction', 'liveStatus']) {
      expect(parseFloat(c[key].fontSize), key).toBeGreaterThanOrEqual(12);
      expect(parseFloat(c[key].fontSize), key).toBeLessThanOrEqual(13);
      expect(c[key].contrast, key).toBeGreaterThanOrEqual(4.5);
    }
    expect(c.body.contrast).toBeGreaterThan(c.activity.contrast);
    expect(c.body.contrast).toBeGreaterThan(c.managedStatus.contrast);
  }
  await writeFile(join(output, `${phase}.json`), JSON.stringify({ browser: browser.version(), results }, null, 2));
  console.log(`已记录 ${results.length} 组会话布局及计算样式。`);
} finally {
  await browser.close();
}
