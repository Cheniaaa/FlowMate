import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase)) throw new Error('请指定 before 或 after');
const output = fileURLToPath(new URL('../.local/ui-evidence/conversation-reading/', import.meta.url));
await mkdir(output, { recursive: true });
const origin = process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const regressions = [];

async function openToolGroup(transcript, toolName) {
  const summary = transcript.getByText('思考摘要', { exact: true });
  await expect(summary).toBeVisible();
  const groupSummary = transcript.getByText('工具活动 · 2 步', { exact: true });
  const group = groupSummary.locator('..');
  await expect(group.getByText('思考摘要', { exact: true })).toHaveCount(0);
  await groupSummary.press('Enter');
  const toolSummary = group.getByText(toolName, { exact: true }).locator('..');
  await toolSummary.press('Enter');
  return toolSummary.locator('..');
}

async function checkMedia(page, windowLabel, prefix) {
  await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&reading=media`);
  const transcript = page.getByRole('region', { name: '持久对话' });
  const tool = await openToolGroup(transcript, 'get_equipment_photo');
  const openOriginal = tool.getByRole('button', { name: '打开原图', exact: true });
  await expect(tool.locator('.tool-result > *')).toHaveText(['设备清单：白板、投影。', '打开原图', '白板和投影均已就位。']);
  await openOriginal.click();
  const original = page.getByRole('dialog', { name: '工具图片 2', exact: true });
  const image = original.getByRole('img', { name: '工具图片 2原图', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => [node.naturalWidth, node.naturalHeight])).toEqual([240, 100]);
  await expect.poll(() => page.evaluate(() => window.syntheticUi.requests
    .filter(request => request.method === 'GET' && request.path.endsWith('/image')).map(request => request.path)))
    .toContain('/artifacts/00000000-0000-4000-8000-000000000079/image');
  await page.screenshot({ path: join(output, `${prefix}-tool-image.png`) });
  await original.getByRole('button', { name: '关闭对话框' }).click();
  await expect(openOriginal).toBeFocused();
}

async function checkStreaming(page, windowLabel, prefix) {
  await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&reading=media`);
  const transcript = page.getByRole('region', { name: '持久对话' });
  const composer = page.getByLabel('消息', { exact: true });
  await composer.fill('能确认白板可以使用吗？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(transcript.getByText('能确认白板可以使用吗？')).toBeVisible();
  await page.evaluate(() => window.syntheticUi.readingPreview());
  await expect(transcript.getByLabel('未提交预览')).toContainText('白板已确认');
  await page.screenshot({ path: join(output, `${prefix}-stream.png`) });
  await page.evaluate(() => window.syntheticUi.readingCommit());
  await expect(transcript.getByText('白板已确认，使用后请擦干净。', { exact: true })).toHaveCount(1);
  await expect(transcript.getByLabel('未提交预览')).toHaveCount(0);
  await expect(transcript.getByText('迟到的片段')).toHaveCount(0);
  await page.screenshot({ path: join(output, `${prefix}-committed.png`) });
}

async function checkApproval(page, windowLabel, prefix) {
  await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&task2=interaction`);
  const composer = page.getByLabel('消息', { exact: true });
  await composer.fill('审批后继续编辑的草稿');
  await page.getByRole('navigation', { name: '会话详情入口', exact: true })
    .getByRole('button', { name: '任务', exact: true }).press('Enter');
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true });
  await detail.getByRole('button', { name: /资料整理员/ }).press('Enter');
  await detail.getByRole('button', { name: '处理任务审批并返回草稿' }).press('Enter');
  const approval = page.getByRole('dialog', { name: '审批本次操作', exact: true });
  await expect(approval).toContainText('会议纪要.md');
  await expect(approval.getByRole('button', { name: '拒绝本次操作' })).toBeInViewport();
  await page.screenshot({ path: join(output, `${prefix}-approval.png`) });
  await approval.getByRole('button', { name: '拒绝本次操作' }).press('Enter');
  await expect(approval).toHaveCount(0);
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('审批后继续编辑的草稿');
  const commands = await page.evaluate(() => window.syntheticUi.requests.filter(request => request.method === 'POST' && request.path.endsWith('/decision')));
  expect(commands).toHaveLength(1);
  expect(commands[0].body.data).toEqual({ allow: false });
}

try {
  for (const [windowLabel, width] of [['main', 1000], ['quick', 520]]) {
    const context = await browser.newContext({ viewport: { width, height: 720 }, colorScheme: 'light' });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/e2e/fixture.html?window=${windowLabel}&reading`);
    await expect(page.getByText('会议在上午十点开始。', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '测试投影' })).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    const transcript = page.getByRole('region', { name: '持久对话' });
    const setScroll = bottom => transcript.evaluate((node, end) => { node.scrollTop = end ? node.scrollHeight : 0; }, bottom);
    await setScroll(false);
    const geometry = await transcript.evaluate(node => {
      const pane = node.getBoundingClientRect();
      const user = [...node.querySelectorAll('.message--user')];
      const answer = [...node.querySelectorAll('.message--assistant')].filter(item => item.querySelector('.markdown-body') &&
        [...item.querySelectorAll('.markdown-body')].some(body => !body.closest('details')));
      const complete = (element, bottom) => {
        const box = element.getBoundingClientRect();
        return box.top >= pane.top - 0.5 && box.bottom <= bottom + 0.5;
      };
      const pairs = bottom => user.filter((entry, index) => complete(entry, bottom) && answer[index] && complete(answer[index], bottom)).length;
      const style = entry => {
        const body = entry.querySelector('.markdown-body');
        const computed = getComputedStyle(body);
        const paragraphs = body.querySelectorAll('p');
        return { height: entry.getBoundingClientRect().height, font: computed.fontSize, lineHeight: computed.lineHeight,
          paragraphGap: paragraphs.length > 1 ? paragraphs[1].getBoundingClientRect().top - paragraphs[0].getBoundingClientRect().bottom : null };
      };
      return { paneHeight: pane.height, scrollHeight: node.scrollHeight,
        completePairs: pairs(pane.bottom), completePairsIn450px: pairs(Math.min(pane.bottom, pane.top + 450)),
        firstUser: style(user[0]), firstAnswer: style(answer[0]), paragraphAnswer: style(answer[2]),
        messageGap: answer[0].getBoundingClientRect().top - user[0].getBoundingClientRect().bottom,
        horizontalOverflow: node.scrollWidth > node.clientWidth };
    });
    const prefix = `${phase}-${windowLabel}-${width}x720`;
    await page.screenshot({ path: join(output, `${prefix}.png`) });
    await setScroll(true);
    if (phase === 'after') {
      const read = await openToolGroup(transcript, '读取文本');
      await expect(read.locator('.tool-result')).toContainText('设备清单：白板、投影。');
      await expect(read.locator('.tool-result')).toBeInViewport();
    }
    await expect(errors).toEqual([]);
    await page.screenshot({ path: join(output, `${prefix}-activity.png`) });
    if (phase === 'after') {
      const cell = transcript.getByRole('cell', { name: '测试投影' });
      await cell.scrollIntoViewIfNeeded();
      await expect(cell).toBeInViewport();
      await page.screenshot({ path: join(output, `${prefix}-table.png`) });
      for (const check of [checkMedia, checkStreaming, checkApproval]) {
        try { await check(page, windowLabel, prefix); }
        catch (error) {
          regressions.push({ window: windowLabel, check: check.name, error: error.message });
          await page.screenshot({ path: join(output, `${prefix}-${check.name}-failed.png`) });
        }
      }
      await expect(errors).toEqual([]);
    }
    results.push({ window: windowLabel, width, height: 720, ...geometry });
    await context.close();
  }
  await writeFile(join(output, `${phase}.json`), JSON.stringify({ browser: browser.version(), results, regressions }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  for (const item of regressions) console.error(`${item.window} ${item.check}: ${item.error}`);
  if (regressions.length) process.exitCode = 1;
} finally {
  await browser.close();
}
