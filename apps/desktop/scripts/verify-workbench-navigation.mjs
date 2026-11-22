import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const origin = process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174';
const output = process.env.FLOWMATE_TASK5_EVIDENCE;
if (!output) throw new Error('Set FLOWMATE_TASK5_EVIDENCE to the local evidence directory');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const draft = '保持这份阅读会草稿';

async function sidebar(page) {
  await expect(page.getByRole('dialog', { name: '项目导航', exact: true })).toHaveCount(0);
  const trigger = page.getByRole('button', { name: '打开项目导航', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  return page.getByRole('complementary', { name: '项目导航', exact: true });
}

async function centered(dialog, { width, height }) {
  await expect(dialog).toBeVisible();
  await expect.poll(async () => {
    const rect = await dialog.boundingBox();
    return Math.abs(rect.x + rect.width / 2 - width / 2) < 2
      && Math.abs(rect.y + rect.height / 2 - height / 2) < 2;
  }).toBe(true);
}

async function provideTaskList(page) {
  await page.evaluate(async () => {
    const fetchFixture = window.fetch;
    const managed = window.syntheticUi.task2Targets().runs.filter(run => run.kind === 'managed');
    const details = await Promise.all(managed.map(async run =>
      (await fetchFixture(`http://synthetic.invalid/v3/runs/${run.id}`)).json()));
    const items = details.map(({ run, tasks, questions, approvals }) => ({
      run, root: tasks.items[0], pending_count: [...questions.items, ...approvals.items].filter(item => item.status === 'pending').length,
      origin_task_id: null, delivery_state: null, task_goal: '核对会议纪要导出',
    }));
    window.fetch = (input, init) => new URL(String(input)).pathname === '/v3/tasks'
      ? Promise.resolve(Response.json({ items, next_cursor: null, watermark: '100' }))
      : fetchFixture(input, init);
  });
}

try {
  for (const width of [1000, 520]) {
    const viewport = { width, height: 720 };
    const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'no-preference' });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/e2e/fixture.html?window=main&reading=hierarchy&task2=interaction&task5=inbox`);
    await expect(page.getByRole('heading', { name: '合成会话', exact: true })).toBeVisible();
    const input = page.getByRole('textbox', { name: '消息', exact: true });
    await input.fill(draft);
    const transcript = page.getByRole('region', { name: '持久对话', exact: true });
    const scrollTop = await transcript.evaluate(node => {
      node.scrollTop = 48;
      return node.scrollTop;
    });
    expect(scrollTop).toBeGreaterThan(0);
    const approval = await page.evaluate(() => window.syntheticUi.task2Targets().approvals[0]);
    await provideTaskList(page);
    const projectNav = await sidebar(page);
    const project = projectNav.getByRole('button', { name: '合成验收项目', exact: true });
    const nameLabel = project.locator('span');
    await expect(nameLabel).toHaveText('合成验收项目');
    await page.evaluate(() => document.fonts.ready);
    const rowWidths = await nameLabel.evaluate(node => ({
      actual: node.clientWidth, required: node.scrollWidth,
      buttons: Array.from(node.closest('.project-heading').children).map(child => ({
        label: child.getAttribute('aria-label'), width: child.getBoundingClientRect().width,
      })),
    }));
    expect(rowWidths.actual, JSON.stringify(rowWidths)).toBeGreaterThanOrEqual(rowWidths.required);
    const projectMenu = projectNav.getByRole('button', { name: '项目「合成验收项目」的更多操作', exact: true });
    await projectMenu.press('Enter');
    await expect(page.getByRole('menuitem', { name: '在此项目新建会话', exact: true })).toBeFocused();
    await page.screenshot({ path: join(output, `${width}-project-menu.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '项目「合成验收项目」的更多操作', exact: true })).toHaveCount(0);
    if (width === 520) await page.getByRole('button', { name: '关闭项目导航', exact: true }).press('Enter');
    for (const [entry, name, file] of [['任务', '任务中心', 'tasks'], ['能力库', '能力库', 'capabilities'],
      ['我的助理', '我的助理', 'assistants'], ['记忆与成长', '记忆与成长', 'memory']]) {
      const nav = await sidebar(page);
      await nav.getByRole('button', { name: entry, exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '返回对话与草稿', exact: true })).toHaveAttribute('data-icon-action', 'back');
      await expect(page.getByRole('heading', { name: '合成会话', exact: true })).toHaveCount(0);
      if (width === 1000) await expect(nav.getByRole('button', { name: '合成会话', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: '项目导航', exact: true })).toHaveCount(0);
      await page.screenshot({ path: join(output, `${width}-${file}.png`), animations: 'disabled' });
      if (file === 'tasks') {
        const detailEntry = page.getByRole('button', { name: '查看任务详情', exact: true }).first();
        await detailEntry.click();
        const back = page.getByRole('button', { name: '返回任务中心', exact: true });
        await expect(back).toHaveAttribute('data-icon-action', 'back');
        await expect(page.getByRole('button', { name: '返回对话与草稿', exact: true })).toHaveCount(0);
        await page.screenshot({ path: join(output, `${width}-task-detail.png`), animations: 'disabled' });
        await back.press('Enter');
        await expect(detailEntry).toBeFocused();
      }
    }
    await (await sidebar(page)).getByRole('button', { name: '合成会话', exact: true }).click();
    await expect(input).toHaveValue(draft);
    await expect.poll(() => transcript.evaluate(node => node.scrollTop)).toBe(scrollTop);

    const configEntry = page.getByRole('button', { name: '运行配置', exact: true });
    await configEntry.click();
    const config = page.getByRole('dialog', { name: '运行配置', exact: true });
    await centered(config, viewport);
    await page.screenshot({ path: join(output, `${width}-run-config.png`), animations: 'disabled' });
    await config.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await page.keyboard.press('Escape');
    await expect(config).toBeVisible();
    await config.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await page.keyboard.press('Escape');
    await expect(configEntry).toBeFocused();
    await configEntry.click();
    await config.getByRole('button', { name: '模型设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings.getByRole('button', { name: '外观与主题', exact: true })).toBeVisible();
    await settings.getByRole('button', { name: '外观与主题', exact: true }).click();
    await expect(settings.getByRole('combobox', { name: '文字大小', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(configEntry).toBeFocused();

    const nav = await sidebar(page);
    await nav.getByRole('button', { name: '待办 1', exact: true }).click();
    const inbox = page.getByRole('dialog', { name: '待办', exact: true });
    await centered(inbox, viewport);
    await expect(inbox.getByText('核对会议纪要导出', { exact: true })).toBeVisible();
    await page.screenshot({ path: join(output, `${width}-inbox.png`), animations: 'disabled' });
    await inbox.getByRole('button', { name: /^审批：/ }).click();
    const decision = page.getByRole('dialog', { name: '审批本次操作', exact: true });
    await centered(decision, viewport);
    await expect(decision).toContainText('会议纪要.md');
    await page.screenshot({ path: join(output, `${width}-approval.png`), animations: 'disabled' });
    await decision.getByRole('button', { name: '拒绝本次操作', exact: true }).click();
    await expect(inbox.getByText('暂无待处理事项')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inbox).toHaveCount(0);
    await expect(width === 520 ? page.getByRole('button', { name: '打开项目导航', exact: true })
      : nav.getByRole('button', { name: /^待办/ })).toBeFocused();
    await expect(input).toHaveValue(draft);
    const submissions = await page.evaluate(() => window.syntheticUi.requests.filter(item => item.path.endsWith('/decision')));
    expect(submissions).toHaveLength(1);
    expect(submissions[0].path).toBe(`/approvals/${approval.id}/decision`);
    expect(submissions[0].body).toMatchObject({ meta: { expected_version: approval.version }, data: { allow: false } });
    expect(errors).toEqual([]);
    results.push({ width, height: 720, scrollTop, approval: 'original approval and version, returned to inbox' });
    await context.close();
  }
  await writeFile(join(output, 'results.json'), `${JSON.stringify({ edge: browser.version(), checks: results }, null, 2)}\n`);
  console.log(`Workbench navigation verified in Edge ${browser.version()} at 1000×720 and 520×720`);
} finally {
  await browser.close();
}
