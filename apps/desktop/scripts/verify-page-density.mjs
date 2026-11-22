import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// 先在修改前运行并传入 before 目录，再使用相同夹具复跑。
const output = resolve(process.argv[2] ?? '.local/ui-evidence/page-density');
const fixture = new URL('/e2e/fixture.html?window=main', process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5177');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const results = {};
const regressions = [];
const listCount = 16;
const longToken = 'continuousReferenceWithoutSeparators'.repeat(5);

async function seed(page) {
  await page.evaluate(async ({ listCount, longToken }) => {
    const { binding, connection, limits, model, modelResolution, page, run, runDetailSummary } = await import('/src/test/fixtures.ts');
    const { memory } = await import('/src/test/memory-fixtures.ts');
    const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const makeList = (size, build) => Array.from({ length: size }, (_, index) => build(index + 1));
    const tasks = makeList(listCount, n => {
      const snapshot = { ...run, id: uuid(200 + n), root_task_id: uuid(300 + n), budget_id: uuid(400 + n), state: 'completed' };
      return { run: snapshot, root: {
        id: snapshot.root_task_id, run_id: snapshot.id, version: 1, binding,
        parent_task_id: null, origin_task_id: null, kind: 'agent', executor_id: 'builtin.agent',
        state: snapshot.state, created_seq: n, deadline_at: null, result_version: null, reason: null,
      }, pending_count: n === 1 ? 2 : 0, origin_task_id: null, delivery_state: 'delivered',
      task_goal: n === listCount ? `归档中文长任务并校对材料链接 ${longToken}` : `校对第 ${n} 份会议纪要` };
    });
    const records = makeList(listCount, n => ({
      ...memory, id: n === 1 ? memory.id : uuid(500 + n),
      text: n === listCount ? `归档时保留中文原文与完整参考链接 ${longToken}` : `检查第 ${n} 类报告时附上来源`,
    }));
    const connections = makeList(8, n => ({
      ...connection, id: n === 1 ? connection.id : uuid(600 + n),
      display_name: n === 1 ? '测试连接' : `资料整理连接 ${n}`,
      endpoint: n === 1 ? `https://example.invalid/v1/${longToken}` : connection.endpoint,
    }));
    const models = makeList(5, n => ({
      ...model, id: n === 1 ? model.id : uuid(700 + n), display_name: `会议纪要模型 ${n}`,
      model_id: n === 1 ? longToken : `meeting-model-${n}`,
    }));
    const fetchFixture = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.origin !== 'http://synthetic.invalid') return fetchFixture(input, init);
      const path = url.pathname.replace('/v3', '');
      if (path === '/tasks') return Response.json(page(tasks));
      if (path === '/model-connections') return Response.json(page(connections));
      if (path === '/models') return Response.json(page(models));
      if (path === `/models/${model.id}/resolved`) return Response.json({ ...modelResolution, ...models[0] });
      if (path === '/memory/records') return Response.json(page(records));
      const record = records.find(item => path === `/memory/records/${item.id}` || path === `/memory/records/${item.id}/evidence`);
      if (record) return Response.json(path.endsWith('/evidence') ? page(record.evidence.map(evidence => ({ evidence, available: true, reason: null }))) : record);
      if (path === `/memory/records/${memory.id}/evidence/0/excerpt` && url.searchParams.get('offset') === '0') {
        const response = await fetchFixture(input, init);
        const value = await response.json();
        const text = `${value.excerpt.text} ${longToken}`;
        const extra = text.length - value.excerpt.text.length;
        return Response.json({ ...value, excerpt: { ...value.excerpt, text, end: text.length, total_chars: value.excerpt.total_chars + extra } });
      }
      if (path === `/memory/records/${memory.id}/evidence/0/excerpt`) {
        const response = await fetchFixture(input, init);
        const value = await response.json();
        return Response.json({ ...value, excerpt: { ...value.excerpt, total_chars: value.excerpt.end } });
      }
      const task = tasks.find(({ run }) => path === `/runs/${run.id}`);
      if (task) {
        return Response.json({ ...runDetailSummary, run: task.run, tasks: page([task.root]),
          activities: page([]), messages: page([]), artifacts: page([]), questions: page([]),
          approvals: page([]), waits: page([]), consumptions: page([]), joins: page([]),
          budget: { id: task.run.budget_id, run_id: task.run.id, version: 1, limits, spent_units: '0',
            reserved_units: '0', model_requests: 0, steps: 0, task_count: 1, total_tokens: 0, reserved_tokens: 0 },
          watermark: page([]).watermark });
      }
      return fetchFixture(input, init);
    };
  }, { listCount, longToken });
}

async function measure(container, selector, visibleBelow) {
  return container.evaluate((panel, { selector, visibleBelow }) => {
    const rect = panel.getBoundingClientRect();
    const floor = visibleBelow ? panel.querySelector(visibleBelow).getBoundingClientRect().bottom : rect.top;
    const rows = [...panel.querySelectorAll(selector)].map(row => row.getBoundingClientRect());
    return {
      firstTop: Math.round(rows[0].top), firstHeight: Math.round(rows[0].height),
      total: rows.length, fullyVisible: rows.filter(row => row.top >= floor - 1 && row.bottom <= rect.bottom + 1).length,
      contentHeight: panel.scrollHeight, clientHeight: panel.clientHeight, overflowX: panel.scrollWidth - panel.clientWidth,
    };
  }, { selector, visibleBelow });
}

async function wheel(page, panel, dy) {
  const { x, y, width, height } = await panel.boundingBox();
  const before = await panel.evaluate(node => node.scrollTop);
  await page.mouse.move(x + width / 2, y + height / 2);
  await page.mouse.wheel(0, dy);
  const progress = expect.poll(() => panel.evaluate(node => node.scrollTop));
  if (dy > 0) await progress.toBeGreaterThan(before);
  else await progress.toBeLessThan(before);
  return { before, after: await panel.evaluate(node => node.scrollTop) };
}

async function settings(page, shot) {
  const sidebar = page.getByRole('complementary', { name: '项目导航', exact: true });
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: '打开项目导航', exact: true }).press('Enter');
  const opener = sidebar.getByRole('button', { name: '设置', exact: true });
  await opener.press('Enter');
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  const panel = dialog.locator('.settings-content');
  const first = dialog.getByRole('button', { name: /测试连接.*example.invalid/ });
  await expect(dialog.locator('.provider-card')).toHaveCount(8);
  const connections = await measure(panel, '.provider-card');
  await shot('connections');
  const scroll = await wheel(page, panel, 380);
  const search = dialog.getByLabel('搜索连接');
  await search.fill('测试连接');
  await expect(dialog.locator('.provider-card')).toHaveCount(1);
  await first.press('Enter');
  await expect(dialog.getByText('凭据状态：未配置')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Endpoint' })).toHaveValue(`https://example.invalid/v1/${longToken}`);
  const connection = await measure(panel, 'fieldset');
  const saveConnection = dialog.getByRole('button', { name: '保存连接' });
  await expect(saveConnection).toBeVisible();
  connection.saveHeight = (await saveConnection.boundingBox()).height;
  await shot('connection-detail');
  await dialog.getByRole('button', { name: '模型设置', exact: true }).press('Enter');
  await dialog.getByRole('button', { name: /会议纪要模型 1/ }).press('Enter');
  const resolved = dialog.getByRole('region', { name: '当前生效配置' });
  await expect(resolved).toContainText('上下文容量：未知');
  const model = await measure(panel, '.resolved-model');
  const saveModel = dialog.getByRole('button', { name: '保存模型' });
  await expect(saveModel).toBeVisible();
  model.saveHeight = (await saveModel.boundingBox()).height;
  await resolved.scrollIntoViewIfNeeded();
  await shot('model-detail');
  const provenance = resolved.getByText('配置来源与计价依据');
  await provenance.press('Enter');
  await expect(provenance).toBeFocused();
  await expect(resolved.getByText('本地请求预算：用户设置', { exact: true })).toBeVisible();
  await shot('model-source');
  await dialog.getByRole('button', { name: '助理设置', exact: true }).press('Enter');
  const defaultModel = dialog.getByRole('combobox', { name: '默认模型', exact: true });
  await defaultModel.focus();
  await expect(defaultModel.getByRole('option', { name: /会议纪要模型 1/ })).toHaveCount(1);
  const assistant = await measure(panel, 'fieldset');
  const saveAssistant = dialog.getByRole('button', { name: '保存助理' });
  await expect(saveAssistant).toBeVisible();
  assistant.saveHeight = (await saveAssistant.boundingBox()).height;
  const focused = await defaultModel.boundingBox();
  const footer = await dialog.locator('.settings-form-actions').boundingBox();
  assistant.defaultModelClearance = Math.round(footer.y - focused.y - focused.height);
  await shot('assistant');
  await dialog.getByRole('button', { name: '完成', exact: true }).press('Enter');
  await expect(opener).toBeFocused();
  return { connections, connection, model, assistant, scroll };
}

async function tasks(page, shot) {
  const sidebar = page.getByRole('complementary', { name: '项目导航', exact: true });
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: '打开项目导航', exact: true }).press('Enter');
  await sidebar.getByRole('button', { name: '任务', exact: true }).press('Enter');
  const panel = page.getByRole('region', { name: '任务管理页面' });
  const center = panel.getByRole('region', { name: '任务中心' });
  const open = center.getByRole('button', { name: '查看任务详情' });
  await expect(open).toHaveCount(listCount);
  const stats = await measure(panel, '.task-center-row', ':scope > header');
  stats.openHeight = (await open.first().boundingBox()).height;
  await shot('task-list');
  stats.scroll = await wheel(page, panel, 4000);
  await expect(center.getByRole('heading', { name: /归档中文长任务/ })).toContainText(longToken);
  await expect(open.last()).toBeInViewport();
  await shot('task-scrolled');
  await open.last().press('Enter');
  await expect(panel.getByRole('heading', { name: '任务详情', exact: true })).toBeVisible();
  await expect(panel.locator('.task-detail').getByText('已完成', { exact: true }).first()).toBeVisible();
  await shot('task-detail');
  await panel.getByRole('button', { name: '返回任务中心' }).press('Enter');
  await expect(open.last()).toBeFocused();
  return stats;
}

async function memories(page, shot) {
  const sidebar = page.getByRole('complementary', { name: '项目导航', exact: true });
  if (!await sidebar.isVisible()) await page.getByRole('button', { name: '打开项目导航', exact: true }).press('Enter');
  await sidebar.getByRole('button', { name: '记忆与成长', exact: true }).press('Enter');
  const panel = page.getByRole('region', { name: '记忆与成长', exact: true });
  const cards = panel.getByRole('region', { name: '记忆审阅' });
  await expect(cards).toHaveCount(listCount);
  const stats = await measure(panel, '.memory-card', ':scope > header');
  stats.actionHeight = (await cards.first().getByRole('button', { name: '记住' }).boundingBox()).height;
  await shot('memory-list');
  stats.scroll = await wheel(page, panel, 4000);
  await expect(cards.last()).toContainText(longToken);
  await expect(cards.last()).toBeInViewport();
  await shot('memory-scrolled');
  const source = cards.first().getByText('查看来源', { exact: true });
  await source.press('Enter');
  const excerpt = cards.first().getByRole('region', { name: '依据 1' });
  const quote = excerpt.locator('blockquote');
  await expect(quote).toContainText(longToken);
  expect(await quote.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const next = excerpt.getByRole('button', { name: '查看下一段依据' });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport();
  await shot('memory-source');
  await next.press('Enter');
  await expect(quote).toHaveText('遇到专业术语请保留英文原名。');
  await expect(excerpt.getByRole('heading', { name: '合成会话 · 原始消息' })).toBeFocused();
  return stats;
}

try {
  for (const width of [1000, 520]) {
    const size = `${width}x720`;
    results[size] = {};
    for (const check of [settings, tasks, memories]) {
      const context = await browser.newContext({ viewport: { width, height: 720 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const shot = name => page.screenshot({ path: join(output, `${size}-${name}.png`), animations: 'disabled' });
      try {
        await page.goto(fixture.href, { timeout: 30000 });
        await expect(page.getByRole('heading', { name: '日常助理', exact: true })).toBeVisible();
        await seed(page);
        const result = await check(page, shot);
        results[size][check.name] = result;
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
        if (check === settings) {
          expect(result.connections.firstHeight).toBeLessThan(142);
          expect(result.connection.firstHeight).toBeLessThan(width === 1000 ? 232 : 380);
          expect(result.assistant.firstHeight).toBeLessThan(width === 1000 ? 315 : 490);
          expect(result.connection.saveHeight).toBeGreaterThanOrEqual(34);
          expect(result.model.saveHeight).toBeGreaterThanOrEqual(34);
          expect(result.assistant.saveHeight).toBeGreaterThanOrEqual(34);
          expect(result.assistant.defaultModelClearance).toBeGreaterThanOrEqual(4);
          for (const panel of [result.connections, result.connection, result.model, result.assistant]) expect(panel.overflowX).toBe(0);
        } else {
          expect(result.fullyVisible).toBeGreaterThanOrEqual(check === tasks ? 5 : width === 1000 ? 8 : 4);
          expect(result.overflowX).toBe(0);
          expect(result.openHeight ?? result.actionHeight).toBeGreaterThanOrEqual(34);
        }
      } catch (error) {
        regressions.push(`${size} ${check.name}: ${error.message}`);
        if (!results[size][check.name]) await shot(`${check.name}-failed`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(join(output, 'results.json'), `${JSON.stringify({ results, regressions }, null, 2)}\n`);
console.log(JSON.stringify({ output, results, regressions }, null, 2));
if (regressions.length) process.exitCode = 1;
