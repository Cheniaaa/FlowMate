import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSessionContext, usageTitle } from './verify-session-context.mjs';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const archive = fileURLToPath(new URL('../.local/ui-evidence/', import.meta.url));
await mkdir(archive, { recursive: true });
const output = await mkdtemp(join(archive, 'run-'));
const results = [];
const fixtureUrl = new URL('/e2e/fixture.html', process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174');
const configurationOnly = process.argv.includes('--configuration');
const composerModelId = '00000000-0000-4000-8000-000000000002';
const attachmentId = '00000000-0000-4000-8000-000000000010';
let currentScreen;

function conversationDetail(page, docked, name) {
  return page.getByRole(docked ? 'complementary' : 'dialog', { name, exact: true });
}

async function closeDetail(page, docked, detail, trigger) {
  if (docked) await detail.getByRole('button', { name: '关闭详情' }).press('Enter');
  else await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function waitForSurfaceMotion(surface) {
  await surface.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
}

async function checkFirstSession(context, label, width, height) {
  for (const scenario of ['clean', 'no-model', 'no-session']) {
    const page = await context.newPage();
    try {
      await page.goto(new URL(`?window=${label}&firstRun=${scenario}`, fixtureUrl).href);
      const guide = page.getByRole('region', { name: '会话引导' });
      const action = guide.getByRole('button');
      const draft = page.getByRole('textbox', { name: '消息', exact: true });
      await expect(guide.getByRole('heading', { name: '今天想做什么？' })).toBeInViewport();
      await expect(action).toHaveCount(scenario === 'no-session' ? 0 : 1);
      if (scenario !== 'no-session') await expect(action).toHaveAccessibleName('配置模型');
      await page.screenshot({ path: join(output, `${label}-${width}x${height}-first-${scenario}.png`) });
      if (scenario === 'no-session') {
        const selectFile = page.getByRole('button', { name: '选择文本文件', exact: true });
        const selectSkill = page.getByRole('button', { name: '选择 Skill', exact: true });
        const selected = page.getByRole('region', { name: '资料选择', exact: true });
        const file = selected.getByRole('button', { name: '移除附件「共享资料.md」', exact: true });
        const skill = page.getByRole('button', { name: '移除 Skill release-note', exact: true });
        const prompt = '在第一场会话创建前写下的问题';
        const writes = () => page.evaluate(() => window.syntheticUi.requests.filter(entry =>
          entry.method === 'POST' && (entry.path === '/grants' || /\/(?:sessions|runs)$/.test(entry.path))));
        await draft.fill(prompt);
        await selectFile.click();
        await expect(selectFile).toBeFocused();
        await expect(file).toHaveCount(0);
        await expect(draft).toHaveValue(prompt);
        await selectFile.click();
        await expect(file).toBeVisible();
        const consent = selected.getByText(/点击发送.*同意/);
        await expect(consent).toContainText('https://example.invalid/v1');
        await expect(consent).toContainText('当前会话');
        await selectSkill.click();
        await page.getByRole('button', { name: '用于本次草稿', exact: true }).click();
        await expect(skill).toBeVisible();
        await expect(selectSkill).toBeFocused();
        expect(await writes()).toEqual([]);
        const settingsTrigger = await openGlobalSettings(page);
        if (label === 'main') {
          const settings = page.getByRole('dialog', { name: '设置', exact: true });
          await settings.getByRole('button', { name: '完成', exact: true }).click();
          await expect(settingsTrigger).toBeFocused();
        } else {
          await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests
            .filter(item => item.command === 'open_settings').at(-1)?.args)).toEqual({ section: 'models' });
        }
        await expect(draft).toHaveValue(prompt);
        await expect(file).toBeVisible();
        await expect(skill).toBeVisible();
        expect(await writes()).toEqual([]);

        await page.getByRole('button', { name: '发送', exact: true }).click();
        const retry = page.getByRole('button', { name: '使用原命令重试', exact: true });
        await expect(retry).toBeVisible();
        await expect(draft).toHaveValue(prompt);
        await expect(file).toBeVisible();
        await expect(skill).toBeVisible();
        expect((await writes()).map(item => item.path)).toEqual(['/workspaces/00000000-0000-4000-8000-000000000001/sessions']);
        await retry.click();

        const sent = page.getByRole('article', { name: '你的消息', exact: true }).filter({ hasText: prompt });
        await expect(sent.getByRole('list', { name: '已发送的附件', exact: true })).toHaveText('共享资料.md');
        await expect(guide).toHaveCount(0);
        await expect(draft).toHaveValue('');
        const submissions = await writes();
        expect(submissions.map(entry => entry.path.split('/').at(-1))).toEqual(['sessions', 'sessions', 'grants', 'runs']);
        expect(submissions[1]).toEqual(submissions[0]);
        const sessionId = submissions[3].path.split('/')[2];
        expect(submissions[2].body.data).toMatchObject({
          scope: { kind: 'session', workspace_id: '00000000-0000-4000-8000-000000000001', session_id: sessionId },
          purposes: ['read', 'model_send'], destination: 'https://example.invalid/v1', resource_ids: [attachmentId],
        });
        expect(submissions[3].body.data).toMatchObject({ text: prompt, model_profile_id: composerModelId,
          model_selection: { model_version: 1, connection_id: '00000000-0000-4000-8000-000000000003', connection_version: 1 },
          sources: { resource_ids: [attachmentId], skill_versions: { [composerModelId]: 'a'.repeat(64) } } });
        await expect(file).toHaveCount(0);
        await expect(skill).toHaveCount(0);
      } else {
        await draft.fill('保留首次配置前的草稿');
        await action.click();
        if (label === 'main') {
          const settings = page.getByRole('dialog', { name: '设置', exact: true });
          await expect(settings.getByRole('button', { name: '新建连接' })).toBeVisible();
          await settings.getByRole('button', { name: '完成', exact: true }).click();
          await expect(action).toBeFocused();
        } else {
          await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests
            .filter(item => item.command === 'open_settings').at(-1)?.args)).toEqual({ section: 'models' });
        }
        await expect(draft).toHaveValue('保留首次配置前的草稿');
      }
      expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
    } finally { await page.close(); }
  }
}

async function checkRail(page, docked, theme, screenshot) {
  const rail = page.locator('nav.conversation-detail-rail');
  await expect(rail).toBeVisible();
  const { width } = page.viewportSize();
  const entries = [
    { name: /^结果(?: · 未读)?$/, icon: 'inbox', panel: '后台交付结果' },
    { name: '任务', icon: 'list-todo', panel: '任务详情' },
    { name: '产物', icon: 'files', panel: '产物' },
    { name: '上下文', icon: 'layers', panel: '上下文', docked: width >= 1000 },
  ].map(entry => ({ ...entry, trigger: rail.getByRole('button', { name: entry.name, exact: true }) }));
  await expect(rail.getByRole('button')).toHaveCount(entries.length);
  const bounds = await rail.boundingBox();
  expect({ x: bounds.x, width: bounds.width }).toEqual({ x: width - 48, width: 48 });
  const buttons = [];
  for (const { trigger, icon } of entries) {
    await expect(trigger.locator(`svg.lucide-${icon}`)).toHaveAttribute('aria-hidden', 'true');
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    const box = await inViewport(trigger);
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    if (buttons.length) {
      const previous = buttons.at(-1);
      expect(box.x).toBe(previous.x);
      expect(box.y).toBeGreaterThanOrEqual(previous.y + previous.height);
    }
    buttons.push(box);
  }
  await entries[0].trigger.focus();
  for (const { trigger } of entries.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
  }
  await screenshot(`detail-rail-${theme}`);
  for (const { trigger, name, panel, docked: inline = docked } of entries) {
    await trigger.press('Enter');
    const detail = conversationDetail(page, inline, panel);
    await expect(detail).toBeVisible();
    const activeEntry = inline ? trigger : detail.getByRole('navigation', { name: '会话详情入口' })
      .getByRole('button', { name, exact: true });
    await expect(activeEntry).toHaveAttribute('aria-pressed', 'true');
    const opened = await rail.boundingBox();
    expect({ x: opened.x, width: opened.width }).toEqual({ x: bounds.x, width: bounds.width });
    if (inline) {
      await detail.getByRole('button', { name: '关闭详情' }).press('Escape');
      await expect(detail).toHaveCount(0);
      await expect(trigger).toBeFocused();
    } else await closeDetail(page, inline, detail, trigger);
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
  }
  return { bounds, buttons, detail: docked ? 'aside' : 'sheet' };
}

async function checkContext(context, label, width) {
  const page = await context.newPage();
  try {
    await checkSessionContext(page, fixtureUrl.origin, label, width);
  } finally {
    await page.close();
  }
}

async function checkReport(page, docked, theme, screenshot, { heading, tableCell }) {
  const detail = conversationDetail(page, docked, '产物');
  const preview = detail.frameLocator('iframe[title="产物预览"]');
  await expect(preview.getByRole('heading', { name: heading })).toBeInViewport();
  await expect(preview.getByRole('cell', { name: tableCell })).toBeInViewport();
  const reading = await preview.locator('body').evaluate(body => {
    const colors = getComputedStyle(body);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const sample = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      return { lightness: (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255, alpha };
    };
    const text = sample(colors.color), paper = sample(colors.backgroundColor);
    return { text: text.lightness, paper: paper.lightness, alpha: paper.alpha, background: colors.backgroundColor,
      scrollWidth: body.scrollWidth, viewportWidth: innerWidth };
  });
  expect(reading.alpha, `产物预览正文需要不透明背景，实际为 ${reading.background}`).toBe(255);
  expect(reading.scrollWidth, '产物预览正文不应横向溢出').toBeLessThanOrEqual(reading.viewportWidth);
  expect(theme === 'dark' ? reading.text - reading.paper : reading.paper - reading.text).toBeGreaterThan(0.5);
  await screenshot(`report-${theme}`);
  return { detail, reading };
}

async function checkDelivery(page, { docked, theme, screenshot, ids, width, height }) {
  const report = page.getByRole('article', { name: '后台交付' }).filter({ hasText: '两位成员已交付' });
  const trigger = report.getByRole('button', { name: '查看交付结果' });
  const input = page.getByLabel('消息', { exact: true });
  const draft = '读完报告后补充会议意见';
  const start = await page.evaluate(() => window.syntheticUi.requests.length);
  await trigger.press('Enter');
  const detail = conversationDetail(page, docked, '后台交付结果');
  const inbox = detail.getByRole('region', { name: '结果收件箱' });
  await expect(inbox.getByRole('article')).toHaveCount(2);
  await expect(inbox.getByRole('article', { name: '不相关的对照交付' })).toHaveCount(0);
  await expect(inbox.getByRole('article', { name: '会议记录整理' })).toBeVisible();
  const [chosenName, assistant, heading, tableCell] = theme === 'dark'
    ? ['图书馆资料核对', '图书资料员', '本周阅读报告', '补充示例']
    : ['会议记录整理', '会议记录员', '会议记录版', '整理意见'];
  const chosen = inbox.getByRole('article', { name: chosenName });
  await expect(chosen).toContainText(assistant);
  const view = chosen.getByRole('button', { name: '查看结果', exact: true });
  await waitForSurfaceMotion(detail);
  const bounds = await detail.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
  if (docked) {
    const chat = await page.getByRole('region', { name: '持久对话' }).boundingBox();
    const composer = await input.boundingBox();
    expect(chat.width).toBeGreaterThan(250);
    expect(chat.x + chat.width).toBeLessThanOrEqual(bounds.x + 1);
    expect(composer.y + composer.height).toBeLessThanOrEqual(height);
    await input.press('End');
    await input.press('Space');
    await expect(input).toHaveValue(`${draft} `);
    await input.press('Backspace');
  } else {
    await expect(page.getByRole('region', { name: '持久对话' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: '关闭详情' })).toBeInViewport();
  }
  await view.press('Enter');
  const member = chosen.getByRole('region', { name: '成员交付' });
  await expect(member).toContainText(theme === 'dark' ? '图书馆资料来源已完成' : '会议记录来源已完成');
  const file = chosen.getByRole('button', { name: '阅读报告.md', exact: true });
  await inViewport(file);
  await screenshot(`delivery-${theme}`);
  await file.press('Enter');
  const { detail: artifacts, reading } = await checkReport(page, docked, theme, screenshot, { heading, tableCell });
  await expect(artifacts.getByRole('region', { name: '产物详情' }).getByRole('heading', { name: '阅读报告.md', exact: true })).toBeVisible();
  const requests = await page.evaluate(from => window.syntheticUi.requests.slice(from).filter(item =>
    /^\/(results\/[^/]+\/view|tasks\/[^/]+\/result|artifacts\/[^/]+\/content)$/.test(item.path)), start);
  const expected = ids[chosenName];
  const views = requests.filter(item => item.method === 'POST');
  expect(views).toHaveLength(1);
  expect(views[0]).toMatchObject({ path: `/results/${expected.delivery}/view`, body: { expected_version: expected.version } });
  expect(views[0].body.command_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(requests.filter(item => item.method === 'GET').map(item => item.path)).toEqual([
    `/tasks/${expected.task}/result`, `/artifacts/${expected.artifact}/content`,
  ]);
  await closeDetail(page, docked, artifacts, trigger);
  await expect(input).toHaveValue(draft);
  await input.press('End');
  await input.press('Space');
  await expect(input).toHaveValue(`${draft} `);
  await input.press('Backspace');
  await expect(input).toHaveValue(draft);
  await screenshot(`report-return-draft-${theme}`);
  return { detail: bounds, source: chosenName, reading, draftEditableAfterClose: true, requests: requests.map(item => item.path) };
}

async function inViewport(control) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ ratio: 0.98 });
  return control.boundingBox();
}

async function centeredBounds(page, dialog) {
  const { width, height } = page.viewportSize();
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return !!bounds && Math.abs(bounds.x + bounds.width / 2 - width / 2) < 2
      && Math.abs(bounds.y + bounds.height / 2 - height / 2) < 2;
  }).toBe(true);
  return dialog.boundingBox();
}

async function openProjectNavigation(page) {
  const sidebar = page.getByRole('complementary', { name: '项目导航', exact: true });
  const drawer = page.getByRole('button', { name: '打开项目导航', exact: true });
  const viaDrawer = !await sidebar.isVisible();
  if (viaDrawer) await drawer.press('Enter');
  return { sidebar, drawer, viaDrawer };
}

async function openGlobalSettings(page) {
  const { sidebar, drawer, viaDrawer } = await openProjectNavigation(page);
  const trigger = sidebar.getByRole('button', { name: '设置', exact: true });
  await trigger.press('Enter');
  if (viaDrawer) await expect(sidebar).toHaveCount(0);
  return viaDrawer ? drawer : trigger;
}

async function setTheme(page, theme, workbench = page) {
  const returnFocus = await openGlobalSettings(workbench);
  const settings = workbench.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('button', { name: '外观与主题', exact: true }).press('Enter');
  const target = theme === 'dark' ? '切换到深色' : '切换到浅色';
  const reverse = theme === 'dark' ? '切换到浅色' : '切换到深色';
  await settings.getByRole('button', { name: target, exact: true }).press('Enter');
  await expect(settings.getByRole('button', { name: reverse, exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '完成', exact: true }).press('Enter');
  await expect(settings).toHaveCount(0);
  await expect(returnFocus).toBeFocused();
  await expect(page.locator('html')).toHaveCSS('color-scheme', theme);
}

async function checkConfiguration(page, screenshot, stage) {
  const input = page.getByLabel('消息', { exact: true });
  const originalDraft = await input.inputValue();
  const draft = originalDraft || '保留运行配置前的草稿';
  if (!originalDraft) await input.fill(draft);
  const configuration = page.getByRole('button', { name: '运行配置', exact: true });
  const panel = page.getByRole('dialog', { name: '运行配置', exact: true });
  const close = panel.getByRole('button', { name: '关闭对话框', exact: true });
  const assistant = panel.getByRole('combobox', { name: '助理', exact: true });
  await configuration.click();
  await expect(close).toBeInViewport({ ratio: 0.98 });
  await screenshot(`configuration-${stage}`);
  const fit = await centeredBounds(page, panel);
  const { width, height } = page.viewportSize();
  expect(fit.x).toBeGreaterThanOrEqual(0);
  expect(fit.y).toBeGreaterThanOrEqual(0);
  expect(fit.x + fit.width).toBeLessThanOrEqual(width);
  expect(fit.y + fit.height).toBeLessThanOrEqual(height);

  const excludeSummary = panel.getByText('本次排除单条记忆', { exact: true });
  if (!await excludeSummary.evaluate(node => node.parentElement.open)) await excludeSummary.click();
  const exclusion = panel.getByRole('checkbox', { name: '本次排除：每份报告附上来源' });
  await exclusion.click();
  await expect(exclusion).toBeChecked();
  await exclusion.click();
  const limitSummary = panel.getByText('本次限额', { exact: true });
  if (!await limitSummary.evaluate(node => node.parentElement.open)) await limitSummary.click();
  const limit = panel.getByRole('spinbutton', { name: '模型请求上限' });
  await limit.fill('7');
  await expect(limit).toHaveValue('7');
  await limit.fill('');

  const authorization = panel.getByRole('button', { name: '管理授权', exact: true });
  await panel.evaluate(element => { element.scrollTop = 0; });
  await panel.hover();
  await page.mouse.wheel(0, 1600);
  await expect(authorization).toBeInViewport({ ratio: 0.98 });
  const scroll = await panel.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight }));
  expect(scroll.top).toBeGreaterThan(0);
  expect(scroll.total).toBeGreaterThan(scroll.height);
  await screenshot(`configuration-${stage}-scrolled`);
  await authorization.click();
  await expect(panel).toHaveCount(0);
  const sheet = page.getByRole('dialog', { name: '管理授权', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: '新增用途授权', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(configuration).toBeFocused();
  await configuration.press('Enter');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(assistant).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(configuration).toBeFocused();
  await input.press('End');
  await input.press('Space');
  await expect(input).toHaveValue(`${draft} `);
  await input.press('Backspace');
  await expect(input).toHaveValue(draft);
  if (!originalDraft) await input.clear();
  return { fit, scroll };
}

async function checkSidebar(page, screenshot) {
  const { sidebar, drawer, viaDrawer } = await openProjectNavigation(page);
  const session = sidebar.getByRole('button', { name: '合成会话', exact: true });
  const collapse = sidebar.getByRole('button', { name: '折叠侧栏', exact: true });
  const expand = sidebar.getByRole('button', { name: '展开侧栏', exact: true });
  const project = sidebar.getByRole('button', { name: '合成验收项目', exact: true });
  const globalNew = sidebar.getByRole('button', { name: '新建会话', exact: true });
  const projectNew = sidebar.getByRole('button', { name: '新建项目', exact: true });
  const projectSession = sidebar.getByRole('button', { name: '项目「合成验收项目」的更多操作', exact: true });
  await expect(project).toBeVisible();
  const bounds = await sidebar.boundingBox();
  let collapsed;
  if (!viaDrawer) {
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.press('Enter');
    await expect(expand).toBeFocused();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(session).toHaveCount(0);
    await expect(globalNew).toBeVisible();
    collapsed = await sidebar.boundingBox();
    expect(collapsed.width).toBeLessThan(bounds.width);
    await screenshot('sidebar-collapsed');
    await expand.press('Enter');
    await expect(collapse).toBeFocused();
    await expect(session).toBeVisible();
  } else await expect(collapse).toHaveCount(0);

  const fold = sidebar.getByRole('button', { name: '收起合成验收项目的会话', exact: true });
  const unfold = sidebar.getByRole('button', { name: '展开合成验收项目的会话', exact: true });
  await fold.press('Enter');
  await expect(unfold).toHaveAttribute('aria-expanded', 'false');
  await expect(unfold).toBeFocused();
  await expect(session).toHaveCount(0);
  await expect(projectSession).toBeVisible();
  await screenshot('sidebar-project-folded');
  await unfold.press('Enter');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(session).toBeVisible();
  await expect(globalNew.locator('svg.lucide-square-pen')).toHaveAttribute('aria-hidden', 'true');
  await expect(projectNew.locator('svg.lucide-plus')).toHaveAttribute('aria-hidden', 'true');
  await expect(projectSession.locator('svg.lucide-ellipsis')).toHaveAttribute('aria-hidden', 'true');
  await screenshot('sidebar-create-entries');
  for (const [index, trigger] of [globalNew, projectSession].entries()) {
    if (viaDrawer && index > 0) await drawer.press('Enter');
    await trigger.press('Enter');
    if (index > 0) await page.getByRole('menuitem', { name: '在此项目新建会话', exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: '新建会话', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(viaDrawer ? drawer : trigger).toBeFocused();
  }
  return { bounds, collapsed, entry: viaDrawer ? 'drawer' : 'sidebar' };
}

async function checkCapability(page, label, theme, screenshot) {
  const trigger = page.getByRole('button', { name: '选择 Skill', exact: true });
  await trigger.press('Enter');
  const library = page.getByRole(label === 'quick' ? 'dialog' : 'region', { name: '能力库', exact: true });
  await library.getByLabel('能力范围').selectOption('workspace');
  const skill = library.getByRole('button', { name: /release-note/ });
  await expect(skill).toContainText('已启用');
  await skill.press('Enter');
  const details = library.getByRole('article', { name: 'Skill 详情' });
  await details.getByText('版本详情', { exact: true }).press('Enter');
  await expect(details).toContainText('当前发布版');
  const save = details.getByRole('button', { name: '导出标准包' });
  await inViewport(save);
  await screenshot(`skills-${theme}`);
  await save.press('Enter');
  const overwrite = page.getByRole('dialog', { name: '确认覆盖', exact: true });
  await expect(overwrite).toContainText('已有的发布说明.zip');
  const geometry = await inViewport(overwrite.getByRole('button', { name: '确认覆盖并保存' }));
  const dialogBounds = await centeredBounds(page, overwrite);
  await screenshot(`overwrite-${theme}`);
  if (theme === 'dark') {
    await overwrite.getByRole('button', { name: '取消覆盖' }).press('Enter');
    await expect(save).toBeFocused();
  } else {
    await overwrite.getByRole('button', { name: '确认覆盖并保存' }).press('Enter');
    await expect(details.getByText('已保存：已有的发布说明.zip')).toBeVisible();
    const writes = await page.evaluate(() => window.syntheticUi.requests.filter(item => item.path === '/capabilities/skill-exports' && item.method === 'POST'));
    expect(writes).toHaveLength(1);
    expect(writes[0].body.data).toMatchObject({ confirmed_target_hash: 'c'.repeat(64), content_hash: 'a'.repeat(64) });
  }
  await expect(overwrite).toHaveCount(0);
  await library.getByRole('button', { name: '返回对话与草稿' }).press('Enter');
  await expect(library).toHaveCount(0);
  await expect(trigger).toBeFocused();
  return { geometry, dialog: dialogBounds };
}

async function checkMcp(page, theme, screenshot) {
  const { sidebar, drawer, viaDrawer } = await openProjectNavigation(page);
  const trigger = sidebar.getByRole('button', { name: '能力库', exact: true });
  await trigger.press('Enter');
  const library = page.getByRole('region', { name: '能力库', exact: true });
  await library.getByRole('tab', { name: 'MCP' }).press('Enter');
  const notes = library.getByRole('button', { name: /Local Notes/ });
  await expect(notes).toContainText('个人');
  await notes.press('Enter');
  const details = library.getByRole('region', { name: 'MCP 配置详情' });
  await expect(details).toContainText('C:\\Program Files\\Notes\\server.exe');
  await expect(details).toContainText('中文 参数');
  const inspect = await inViewport(details.getByRole('button', { name: '编辑配置' }));
  await screenshot(`mcp-${theme}`);
  await library.getByRole('button', { name: '返回对话与草稿' }).press('Enter');
  await expect(viaDrawer ? drawer : trigger).toBeFocused();
  return inspect;
}

async function checkConnectionCards(settings, theme, screenshot) {
  const list = settings.getByRole('region', { name: '连接与模型', exact: true });
  const search = list.getByRole('textbox', { name: '搜索连接' });
  const connection = list.getByRole('button', { name: /测试连接.*https:\/\/example\.invalid\/v1/ });
  const create = list.getByRole('button', { name: '新建连接', exact: true });
  await expect(connection.getByText('测试连接', { exact: true })).toBeVisible();
  await expect(connection.getByText('OpenAI Chat Completions', { exact: true })).toBeVisible();
  await expect(connection.getByText('https://example.invalid/v1', { exact: true })).toBeVisible();
  await expect(create.locator('svg.lucide-plus')).toHaveAttribute('aria-hidden', 'true');
  await expect(connection).toHaveCSS('border-top-style', 'solid');
  await waitForSurfaceMotion(settings);
  const searchBox = await search.boundingBox();
  const listBox = await list.boundingBox();
  expect(Math.abs(searchBox.x - listBox.x)).toBeLessThan(2);
  expect(Math.abs(searchBox.width - listBox.width)).toBeLessThan(2);
  const existing = await inViewport(connection);
  const add = await inViewport(create);
  expect(searchBox.y + searchBox.height).toBeLessThan(existing.y);
  const title = await list.getByRole('heading', { name: '连接与模型' }).boundingBox();
  expect(add.x).toBeGreaterThan(title.x + title.width);
  expect(add.y + add.height).toBeLessThan(searchBox.y);
  await screenshot(`connection-cards-${theme}`);
  await search.fill('没有匹配的合成连接');
  await expect(connection).toHaveCount(0);
  await expect(create).toBeVisible();
  await search.fill('example.invalid');
  await expect(connection).toBeVisible();
  await create.press('Enter');
  await expect(settings.getByRole('textbox', { name: '连接名称' })).toHaveValue('');
  await settings.getByRole('button', { name: '返回连接列表' }).press('Enter');
  await expect(connection).toBeVisible();
  return { search: searchBox, existing, add };
}

async function checkSettings(page, theme, screenshot) {
  const returnFocus = await openGlobalSettings(page);
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  const cards = await checkConnectionCards(settings, theme, screenshot);
  const connection = settings.getByRole('button', { name: /测试连接.*https:\/\/example\.invalid\/v1/ });
  await expect(connection).toBeVisible();
  await connection.press('Enter');
  await expect(settings.getByText('凭据状态：未配置')).toBeVisible();
  const geometry = { cards, connection: await inViewport(settings.getByRole('button', { name: '保存连接', exact: true })) };
  await screenshot(`connection-settings-${theme}`);
  await settings.getByRole('button', { name: '模型设置', exact: true }).press('Enter');
  await settings.getByRole('button', { name: '更多模型', exact: true }).press('Enter');
  await settings.getByRole('button', { name: /explicit-model/ }).press('Enter');
  const resolved = settings.getByRole('region', { name: '当前生效配置' });
  await expect(resolved).toContainText('上下文容量：未知');
  await resolved.scrollIntoViewIfNeeded();
  await screenshot(`model-settings-${theme}`);
  await settings.getByRole('button', { name: '助理设置', exact: true }).press('Enter');
  const defaultModel = settings.getByRole('combobox', { name: '默认模型', exact: true });
  await expect(defaultModel).toBeVisible();
  // 助理表单与模型库各自独立分页。
  await settings.getByRole('button', { name: '更多模型', exact: true }).press('Enter');
  await expect(defaultModel.getByRole('option', { name: /explicit-model.*测试连接/ })).toHaveCount(1);
  geometry.assistant = await inViewport(settings.getByRole('button', { name: '保存助理', exact: true }));
  await screenshot(`assistant-settings-${theme}`);
  await settings.getByRole('button', { name: '完成', exact: true }).press('Enter');
  await expect(settings).toHaveCount(0);
  await expect(returnFocus).toBeFocused();
  return geometry;
}

async function checkMemory(page, theme, screenshot) {
  const { sidebar, drawer, viaDrawer } = await openProjectNavigation(page);
  const trigger = sidebar.getByRole('button', { name: '记忆与成长', exact: true });
  await trigger.press('Enter');
  const memoryPage = page.getByRole('region', { name: '记忆与成长', exact: true });
  await expect(memoryPage.getByText('以后使用中文回答', { exact: true })).toBeVisible();
  await expect(memoryPage.getByText('适用范围：个人')).toBeVisible();
  const source = memoryPage.getByText('查看来源', { exact: true });
  await page.evaluate(() => window.syntheticUi.failEvidenceRead());
  await source.press('Enter');
  const excerpt = memoryPage.getByRole('region', { name: '依据 1' });
  const alert = excerpt.getByRole('alert');
  await expect(alert).toContainText('原始资料暂时无法读取');
  const retry = excerpt.getByRole('button', { name: '重试读取依据' });
  await inViewport(retry);
  await expect(alert).toBeInViewport();
  expect(await alert.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await screenshot(`memory-long-error-${theme}`);
  await retry.press('Enter');
  const quote = excerpt.locator('blockquote');
  await expect(quote).toHaveText('以后使用中文回答。');
  const next = excerpt.getByRole('button', { name: '查看下一段依据' });
  const geometry = await inViewport(next);
  await screenshot(`memory-source-${theme}`);
  await next.press('Enter');
  await expect(quote).toHaveText('遇到专业术语请保留英文原名。');
  await expect(excerpt.getByRole('heading', { name: '合成会话 · 原始消息' })).toBeFocused();
  if (theme === 'light') {
    await page.evaluate(() => window.syntheticUi.invalidateEvidence());
    await expect(memoryPage.getByText('依据已失效或记忆已改变，原文已收回。')).toBeVisible();
    await expect(quote).toHaveCount(0);
    await expect(source).toBeFocused();
    await screenshot('memory-source-invalidated-light');
  }
  const queries = await page.evaluate(() => window.syntheticUi.requests.filter(item => item.path.endsWith('/evidence/0/excerpt')).map(item => item.query));
  expect(queries).toContainEqual({ expected_revision: '3', offset: '0' });
  expect(queries).toContainEqual({ expected_revision: '3', offset: String('以后使用中文回答。'.length) });
  const more = memoryPage.getByRole('button', { name: '更多记忆管理' });
  await more.press('Enter');
  await page.getByRole('menuitem', { name: '新建记忆' }).press('Enter');
  const editor = page.getByRole('dialog', { name: '新建长期记忆' });
  const memoryText = editor.getByRole('textbox', { name: '新记忆内容', exact: true });
  await memoryText.fill('未保存的个人偏好');
  await memoryText.dispatchEvent('compositionstart');
  await page.keyboard.press('Escape');
  await expect(memoryText).toBeFocused();
  await expect(memoryText).toHaveValue('未保存的个人偏好');
  await expect(editor.getByRole('button', { name: '放弃更改' })).toHaveCount(0);
  await memoryText.dispatchEvent('compositionend');
  await page.keyboard.press('Escape');
  const resume = editor.getByRole('button', { name: '继续编辑' });
  await inViewport(resume);
  const dialogBounds = await centeredBounds(page, editor);
  await screenshot(`memory-editor-${theme}`);
  await resume.press('Enter');
  await expect(memoryText).toBeFocused();
  await expect(memoryText).toHaveValue('未保存的个人偏好');
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: '放弃更改' }).press('Enter');
  await expect(more).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(memoryPage).toHaveCount(0);
  await expect(viaDrawer ? drawer : trigger).toBeFocused();
  const returnFocus = await page.evaluate(() => {
    const active = document.activeElement;
    return active.getAttribute('aria-label') ?? (active.matches('body') ? 'body' : active.id || active.textContent.trim());
  });
  if (viaDrawer) await screenshot(`memory-return-${theme}`);
  return { next: geometry, editor: dialogBounds, returnFocus };
}

async function checkPet() {
  const observations = {};
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ viewport: { width: 88, height: 88 }, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    currentScreen = { page, name: `ball-88x88-${reducedMotion}`, errors };
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('?window=ball', fixtureUrl).href);
    const bird = page.getByRole('button', { name: /FlowMate 折纸鸟/ });
    await expect(bird).toHaveAttribute('data-pose', 'idle');
    observations[reducedMotion] = {};
    for (const [pose, actions, results, part, animation] of [
      ['mail', 0, 2, 'letter', 'pet-carry'],
      ['attention', 1, 2, 'wing', 'pet-unfold'],
      ['idle', 0, 0, 'art', 'pet-settle'],
    ]) {
      await page.evaluate(([actions, results]) => window.syntheticUi.petCounts({
        pending_actions: actions, pending_questions: actions, pending_approvals: 0, unviewed_results: results,
      }), [actions, results]);
      await expect(bird).toHaveAttribute('data-pose', pose);
      await expect(bird).toHaveAccessibleDescription(`${actions} 项待处理 · ${results} 项未查看`);
      const motion = await bird.locator(`.desktop-pet__${part}`).evaluate(element => ({
        animation: getComputedStyle(element).animationName,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      }));
      expect(motion).toEqual({ animation: reducedMotion === 'reduce' ? 'none' : animation, reduced: reducedMotion === 'reduce' });
      observations[reducedMotion][pose] = motion;
    }
    // 只保留减动结果。完整纸鸟三态截图由桌宠验收单独维护。
    if (reducedMotion === 'reduce') await page.screenshot({ path: join(output, 'ball-88x88-reduced-idle.png') });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => ({
      unexpectedRequests: window.syntheticUi.unexpectedRequests,
      requests: window.syntheticUi.requests,
    }))).toEqual({ unexpectedRequests: [], requests: [] });
    await context.close();
  }
  return observations;
}

try {
  await expect.poll(() => fetch(fixtureUrl)
    .then(response => response.status, () => 0), { timeout: 15000 }).toBe(200);
  const windows = configurationOnly ? [[520, 720, 'main'], [520, 720, 'quick'], [1000, 720, 'main']]
    : [[1440, 960, 'main'], [1000, 720, 'main'], [520, 720, 'quick']];
  for (const [width, height, label] of windows) {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    if (!configurationOnly && width <= 1000) await checkFirstSession(context, label, width, height);
    if (!configurationOnly) {
      await checkContext(context, label, width);
      if (label === 'quick') await checkContext(context, 'main', width);
    }
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(8000);
    currentScreen = { page, name: `${label}-${width}x${height}`, errors };
    const screenshot = name => page.screenshot({ path: join(output, `${currentScreen.name}-${name}.png`) });
    const docked = label === 'main' && width >= 1200;
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL(`?window=${label}`, fixtureUrl).href);
    await expect(page.getByRole('heading', { name: '日常助理', exact: true })).toBeVisible();
    const modelTrigger = page.getByRole('button', { name: '选择模型', exact: true });
    await modelTrigger.click();
    const modelOption = page.getByRole('option').and(page.locator(`[data-model-id="${composerModelId}"]`));
    await expect(modelOption).toHaveAttribute('aria-selected', 'true');
    await expect(modelOption).toContainText('explicit-model');
    await modelOption.click();
    await expect(modelTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('dialog', { name: '模型列表', exact: true })).toHaveCount(0);
    const messageInput = page.getByRole('textbox', { name: '消息', exact: true });
    await expect(messageInput).toBeFocused();
    const emptyHeight = (await messageInput.boundingBox()).height;
    const header = page.locator('.conversation-header');
    const headerBounds = await header.boundingBox();
    await messageInput.fill('第一行\n第二行\n第三行\n第四行\n第五行\n第六行\n第七行');
    expect((await messageInput.boundingBox()).height).toBeGreaterThan(emptyHeight);
    await page.evaluate(() => window.syntheticUi.petCounts({
      pending_actions: 2, pending_questions: 1, pending_approvals: 1, unviewed_results: 3,
    }));
    const announcement = page.getByText('待办 2 · 未查看结果 3', { exact: true });
    await expect(announcement).toHaveCount(1);
    expect((await announcement.boundingBox()).height).toBeLessThanOrEqual(1);
    expect(await header.boundingBox()).toEqual(headerBounds);
    await expect(messageInput).toBeFocused();
    await messageInput.fill('');
    expect((await messageInput.boundingBox()).height).toBe(emptyHeight);
    await screenshot('empty-session');
    if (configurationOnly) {
      await expect(page.getByRole('heading', { name: '合成会话', exact: true })).toBeVisible();
      const empty = await checkConfiguration(page, screenshot, 'empty');
      const composer = page.getByLabel('消息', { exact: true });
      await composer.fill('合成配置验收会话');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toBeVisible();
      const sentModel = await page.evaluate(() => window.syntheticUi.requests
        .find(item => item.method === 'POST' && item.path.endsWith('/runs'))?.body.data.model_profile_id);
      expect(sentModel).toBe(composerModelId);
      await page.evaluate(() => window.syntheticUi.complete());
      await expect(page.getByRole('article', { name: '日常助理的回复' })).toContainText('合成验收已完成');
      const completion = page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: '任务已完成' });
      await completion.getByRole('button', { name: '关闭通知' }).click();
      await expect(completion).toHaveCount(0);
      await composer.fill('已有对话的运行配置草稿');
      const thread = await checkConfiguration(page, screenshot, 'thread');
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
      results.push({ width, height, label, configuration: { empty, thread }, errors });
      await context.close();
      continue;
    }
    const sidebar = await checkSidebar(page, screenshot);
    if (label === 'quick') await page.getByRole('button', { name: '打开项目导航' }).click();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '新建项目' })).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeFocused();
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    await page.getByLabel('项目名称', { exact: true }).fill('新合成项目');
    await page.getByRole('button', { name: '创建项目', exact: true }).click();
    if (label === 'quick') await page.getByRole('button', { name: '打开项目导航' }).click();
    await page.getByRole('button', { name: '项目「新合成项目」的更多操作', exact: true }).press('Enter');
    await page.getByRole('menuitem', { name: '在此项目新建会话', exact: true }).press('Enter');
    await page.getByLabel('新会话标题', { exact: true }).fill('新合成会话');
    await page.getByRole('button', { name: '创建会话', exact: true }).click();
    await expect(page.getByRole('heading', { name: '新合成会话', exact: true })).toBeVisible();
    await page.getByLabel('消息', { exact: true }).fill('合成用户消息');
    const admission = page.getByRole('combobox', { name: '发送前等待的服务' });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const cancelWait = page.getByRole('button', { name: '取消等待' });
    const submitted = () => page.evaluate(() => window.syntheticUi.requests.filter(item => item.method === 'POST'
      && item.path.endsWith('/runs')).map(item => item.body.data.model_profile_id));
    await admission.selectOption({ label: '等 Local Notes 就绪后发送' });
    await send.click();
    await cancelWait.click();
    await page.evaluate(() => window.dispatchEvent(new Event('fixture-mcp-ready')));
    await expect(send).toBeEnabled();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('合成用户消息');
    expect(await submitted()).toEqual([]);
    await admission.selectOption({ label: '等 Local Notes 就绪后发送' });
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(cancelWait).toBeVisible();
    expect(await submitted()).toEqual([]);
    await page.evaluate(() => window.dispatchEvent(new Event('fixture-mcp-ready')));
    await expect(page.getByRole('article', { name: '你的消息', exact: true })).toBeVisible();
    expect(await submitted()).toEqual([composerModelId]);
    await page.getByRole('button', { name: '停止当前运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toHaveCount(0);
    await page.getByLabel('消息', { exact: true }).fill('完成合成验证');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toBeVisible();
    const ids = await page.evaluate(() => window.syntheticUi.complete());
    await expect(page.getByRole('article', { name: '日常助理的回复' })).toContainText('合成验收已完成');
    await expect(page.getByRole('region', { name: '持久对话' }).getByText('合成验收已完成，可以继续下一步。', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('region', { name: '本次费用', exact: true })).toHaveCount(0);
    const completed = page.locator('[data-sonner-toast][data-type="success"]').filter({ hasText: '任务已完成' });
    await expect(completed).toBeVisible();
    await completed.getByRole('button', { name: '关闭通知' }).click();
    await expect(completed).toHaveCount(0);
    const contextEntry = page.getByRole('button', { name: '上下文', exact: true });
    const contextDocked = label === 'main' && width >= 1000;
    const contextDetail = conversationDetail(page, contextDocked, '上下文');
    await contextEntry.press('Enter');
    const usage = contextDetail.locator('details').filter({ has: page.locator('summary').filter({ hasText: usageTitle }) });
    await usage.locator('summary').click();
    await expect(usage.getByText('$0.003', { exact: true })).toBeVisible();
    await expect(usage.getByText('费用按记录用量和固定价格估算。', { exact: true })).toBeVisible();
    await closeDetail(page, contextDocked, contextDetail, contextEntry);
    const composerInput = page.getByLabel('消息', { exact: true });
    const artifactEntry = page.getByRole('button', { name: '产物', exact: true });
    await composerInput.fill('读完报告后补充会议意见');
    const deliveries = {}, management = {}, rail = {};
    const themeHost = label === 'quick' ? await context.newPage() : page;
    if (label === 'quick') {
      await themeHost.goto(new URL('?window=main', fixtureUrl).href);
      await expect(themeHost.getByRole('heading', { name: '日常助理', exact: true })).toBeVisible();
    }
    for (const theme of ['dark', 'light']) {
      await setTheme(page, theme, themeHost);
      rail[theme] = await checkRail(page, docked, theme, screenshot);
      deliveries[theme] = await checkDelivery(page, { docked, theme, screenshot, ids, width, height });
      management[theme] = { overwrite: await checkCapability(page, label, theme, screenshot) };
      if (label === 'main') {
        management[theme].mcp = await checkMcp(page, theme, screenshot);
        management[theme].settings = await checkSettings(page, theme, screenshot);
        management[theme].evidence = await checkMemory(page, theme, screenshot);
      }
      await expect(composerInput).toHaveValue('读完报告后补充会议意见');
    }
    if (label === 'quick') await themeHost.close();
    await artifactEntry.press('Enter');
    const artifactDetail = conversationDetail(page, docked, '产物');
    await expect(artifactDetail).toBeVisible();
    await closeDetail(page, docked, artifactDetail, artifactEntry);
    await page.getByLabel('消息', { exact: true }).fill('只属于本轮的失败输入');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    await page.evaluate(() => window.syntheticUi.fail('model_authentication_failed'));
    const failedInput = page.getByRole('article', { name: '你的消息', exact: true }).filter({ hasText: '只属于本轮的失败输入' });
    await expect(failedInput).not.toContainText('服务商拒绝了此连接的凭据');
    const failureNotice = page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: '服务商拒绝了此连接的凭据' });
    await expect(failureNotice).toHaveCount(1);
    await expect(failureNotice).toBeVisible();
    await expect(failureNotice.locator('xpath=..')).toHaveAttribute('data-y-position', 'top');
    await expect(failureNotice.locator('xpath=..')).toHaveAttribute('data-x-position', 'right');
    await expect.poll(async () => {
      const rect = await failureNotice.boundingBox();
      return !!rect && rect.y >= 0 && rect.y < height / 3 && rect.x >= 0 && rect.x + rect.width <= width;
    }).toBe(true);
    await page.screenshot({ path: join(output, `${label}-${width}x${height}-connection.png`) });
    await page.getByLabel('消息', { exact: true }).fill('故障后新草稿');
    await failureNotice.getByRole('button', { name: '检查连接' }).click();
    if (label === 'main') {
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      await expect(settings.getByRole('combobox', { name: '编辑连接', exact: true })).toHaveValue('00000000-0000-4000-8000-000000000003');
      for (const title of ['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages']) {
        await expect(settings.getByRole('option', { name: title, exact: true })).toHaveCount(1);
      }
      await settings.getByRole('combobox', { name: '协议', exact: true }).selectOption('openai_responses');
      await expect(settings.getByRole('combobox', { name: '协议', exact: true })).toHaveValue('openai_responses');
      await settings.getByRole('button', { name: '取消编辑', exact: true }).click();
      await expect(settings.getByRole('combobox', { name: '协议', exact: true })).toHaveValue('openai_compatible');
      await settings.getByRole('button', { name: '模型设置', exact: true }).click();
      await settings.getByRole('button', { name: '更多模型', exact: true }).click();
      await settings.getByRole('button', { name: /explicit-model/ }).click();
      await expect(settings.getByText(/价格未知：.*价格目录映射.*不代表免费/)).toBeVisible();
      const resolved = settings.getByRole('region', { name: '当前生效配置' });
      await expect(resolved).toContainText('上下文容量：未知');
      await expect(resolved).toContainText('最大输入：未知');
      await expect(resolved).toContainText('最大输出：未知');
      await expect(resolved).toContainText('本地请求预算：8,192 token');
      await expect(resolved).not.toContainText('price_unknown');
      await page.screenshot({ path: join(output, `${label}-${width}x${height}-model.png`) });
      await settings.getByRole('button', { name: '关闭设置' }).click();
    } else {
      await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests.filter(item => item.command === 'show_workbench').at(-1)?.args.target))
        .toEqual({ kind: 'connection', connection_id: '00000000-0000-4000-8000-000000000003' });
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
    const attachmentChoice = page.getByRole('region', { name: '资料选择', exact: true });
    const consent = attachmentChoice.getByText(/点击发送.*同意/);
    await expect(consent).toContainText('https://example.invalid/v1');
    await expect(consent).toContainText('当前会话');
    await expect(attachmentChoice.getByRole('button', { name: /授权读取并发送/ })).toHaveCount(0);
    await page.getByLabel('消息', { exact: true }).fill('本次附件发送意图');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('');
    const attachmentWrites = await page.evaluate(start => window.syntheticUi.requests.slice(start)
      .filter(item => item.method === 'POST' && (item.path === '/grants' || item.path.endsWith('/runs'))), attachmentStart);
    expect(attachmentWrites).toHaveLength(2);
    expect(attachmentWrites[0]).toMatchObject({ path: '/grants', body: { data: {
      scope: { kind: 'session', session_id: attachmentWrites[1].path.split('/')[2] },
      purposes: ['read', 'model_send'], destination: 'https://example.invalid/v1', resource_ids: [attachmentId],
    } } });
    expect(attachmentWrites[1].body.data).toMatchObject({ text: '本次附件发送意图', sources: { resource_ids: [attachmentId] } });
    await expect(page.getByRole('button', { name: '重试状态同步', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '停止当前运行', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止当前运行', exact: true })).toHaveCount(0);
    const resultsEntry = page.getByRole('button', { name: /^结果/ });
    await resultsEntry.press('Enter');
    const inboxDetail = conversationDetail(page, docked, '后台交付结果');
    await expect(inboxDetail.getByRole('article', { name: '不相关的对照交付' })).toBeVisible();
    await closeDetail(page, docked, inboxDetail, resultsEntry);
    await page.getByLabel('消息', { exact: true }).fill('保留中的草稿');
    if (label === 'main') {
      const returnFocus = await openGlobalSettings(page);
      const settings = page.getByRole('dialog', { name: '设置', exact: true });
      const search = settings.getByRole('textbox', { name: '搜索连接', exact: true });
      await search.focus();
      await search.dispatchEvent('compositionstart');
      await page.keyboard.press('Escape');
      await expect(settings).toBeVisible();
      await search.dispatchEvent('compositionend');
      await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
      await expect(settings).toHaveCount(0);
      await expect(returnFocus).toBeFocused();
    }
    await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留中的草稿');
    if (label === 'quick') {
      await openGlobalSettings(page);
      await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests.filter(item => item.command === 'open_settings')
        .map(item => item.args))).toEqual([{ section: 'models' }]);
      await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留中的草稿');
      const { sidebar: projectNavigation } = await openProjectNavigation(page);
      await projectNavigation.getByRole('button', { name: '记忆与成长', exact: true }).press('Enter');
      await expect.poll(() => page.evaluate(() => window.syntheticUi.nativeRequests.filter(item => item.command === 'show_workbench').at(-1)?.args.target))
        .toEqual({ kind: 'memory' });
      await expect(composerInput).toHaveValue('保留中的草稿');
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
    await page.screenshot({ path: join(output, `${label}-${width}x${height}.png`) });
    results.push({ width, height, label, geometry, rail, sidebar, deliveries, management, errors, checks: ['send', 'mcp-wait-cancel', 'mcp-wait-send-once', 'stop', 'completion', 'related-delivery-and-same-name-artifact', 'artifact-theme-and-draft', 'skill-overwrite', 'failure-connection', 'credential-draft', 'attachment-consent', 'context-cost', 'sidebar-fold-and-create', 'detail-rail-geometry-and-focus', 'draft', 'default-model-tail', 'current-context-and-lazy-session-usage',
      ...(width <= 1000 ? ['first-file-and-skill-command-retry'] : []),
      ...(label === 'main' ? ['three-protocols', 'unknown-model-capacity', 'automatic-settings-return-focus', 'explicit-settings-return-focus', 'synthetic-ime', 'memory-composition-and-return-focus'] : ['global-settings-host-request', 'session-cancel-focus', 'session-navigation-focus', 'expand-workbench-focus'])],
      requests: await page.evaluate(() => window.syntheticUi.requests.length) });
    if (label === 'quick') {
      const workbench = await context.newPage();
      workbench.setDefaultTimeout(8000);
      const errors = [];
      currentScreen = { page: workbench, name: `main-${width}x${height}`, errors };
      workbench.on('pageerror', error => errors.push(error.message));
      await workbench.goto(new URL('?window=main', fixtureUrl).href);
      const capture = name => workbench.screenshot({ path: join(output, `main-${width}x${height}-${name}.png`) });
      await expect(workbench.getByRole('heading', { name: '合成会话', exact: true })).toBeVisible();
      const workbenchDraft = workbench.getByLabel('消息', { exact: true });
      await workbenchDraft.fill('查看记忆后继续处理这份草稿');
      const settings = {};
      for (const theme of ['dark', 'light']) {
        await setTheme(workbench, theme);
        settings[theme] = {
          mcp: await checkMcp(workbench, theme, capture),
          settings: await checkSettings(workbench, theme, capture),
          evidence: await checkMemory(workbench, theme, capture),
        };
        await expect(workbenchDraft).toHaveValue('查看记忆后继续处理这份草稿');
      }
      expect(errors).toEqual([]);
      expect(await workbench.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
      results.push({ width, height, label: 'main', management: settings, errors, checks: ['current-context-and-lazy-session-usage'],
        requests: await workbench.evaluate(() => window.syntheticUi.requests.length) });
    }
    await context.close();
  }
  const pet = configurationOnly ? undefined : await checkPet();
  const summary = JSON.stringify({ browser: browser.version(), results, pet }, null, 2);
  await writeFile(join(output, 'results.json'), summary);
  console.log(output);
  console.log(summary);
} catch (error) {
  if (currentScreen && !currentScreen.page.isClosed()) {
    const { page, name, errors } = currentScreen;
    await page.screenshot({ path: join(output, `${name}-failed.png`) });
    const details = await page.evaluate(() => ({
      notices: Array.from(document.querySelectorAll('[role="alert"],[data-sonner-toast]'), node => node.textContent),
      unexpectedRequests: window.syntheticUi?.unexpectedRequests,
      focus: document.activeElement?.outerHTML.slice(0, 300),
    }));
    console.error(output, { name, errors, ...details });
  }
  throw error;
} finally { await browser.close(); }
