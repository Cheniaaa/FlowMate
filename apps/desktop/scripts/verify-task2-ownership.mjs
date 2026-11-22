import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const archive = fileURLToPath(new URL('../.local/ui-evidence/', import.meta.url));
await mkdir(archive, { recursive: true });
const output = await mkdtemp(join(archive, 'task2-ownership-'));
const base = new URL('/e2e/fixture.html', process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174');
const windowSizes = [[1000, 'main'], [520, 'quick'], [1440, 'main']];
const input = page => page.getByLabel('消息', { exact: true });
const taskEntry = page => page.getByRole('navigation', { name: '会话详情入口', exact: true })
  .getByRole('button', { name: '任务', exact: true });
const requests = page => page.evaluate(() => window.syntheticUi.requests);
const targets = page => page.evaluate(() => window.syntheticUi.task2Targets());
const draft = '继续补充原会话的会议草稿';
const check = '核对提交状态';
const retry = '使用原命令重试';
const receipt = page => page.getByRole('region', { name: '命令状态' });

async function openPage(width, kind, scenario) {
  const page = await browser.newPage({ viewport: { width, height: 720 } });
  const url = new URL(base);
  url.search = new URLSearchParams({ window: kind, task2: scenario });
  await page.goto(url.href);
  await expect(page.getByRole('heading', { name: '合成会话', exact: true })).toBeVisible();
  return page;
}

async function verifyStops() {
  const page = await openPage(1000, 'main', 'stop');
  try {
    const before = await targets(page);
    const [workspace, otherWorkspace] = before.workspaces;
    const [session, otherSession, remoteSession] = before.sessions;
    const initialRuns = before.runs;
    const status = page.locator('.connection-status');
    await input(page).fill(draft);
    const statusBefore = await status.textContent();

    async function stop(triggerLabel, action, targetPath, generation, querySession, expectedLocation, image, replay = false) {
      const from = (await requests(page)).length;
      await page.getByRole('complementary', { name: '项目导航', exact: true })
        .getByRole('button', { name: triggerLabel, exact: true }).press('Enter');
      await page.getByRole('menuitem', { name: action, exact: true }).press('Enter');
      await expect(receipt(page)).toContainText('提交状态待确认');
      const first = (await requests(page)).slice(from).filter(item => item.path === `${targetPath}/stop-all`);
      expect(first).toHaveLength(1);
      const [{ body }] = first;
      expect(body).toEqual({ command_id: expect.stringMatching(/^[\da-f-]{36}$/), expected_version: generation });
      await page.screenshot({ path: join(output, image) });
      const location = await receipt(page).innerText();
      if (querySession) {
        const statusCheck = receipt(page).getByRole('button', { name: check });
        await expect(statusCheck).toBeVisible();
        if (!replay) {
          await statusCheck.press('Enter');
          const checks = (await requests(page)).slice(from).filter(item => /\/commands\//.test(item.path));
          expect(checks.map(item => item.path)).toEqual([`/sessions/${querySession}/commands/${body.command_id}`]);
        }
      } else {
        await expect(receipt(page).getByRole('button', { name: check })).toHaveCount(0);
      }
      if (replay || !querySession) {
        await receipt(page).getByRole('button', { name: retry }).press('Enter');
      }
      await expect(receipt(page)).toHaveCount(0);
      expect(location).toContain(expectedLocation);
      expect(location).not.toContain(' · 合成会话\n');
      await expect(input(page)).toHaveValue(draft);
      await expect(status).toHaveText(statusBefore);
      const relevant = (await requests(page)).slice(from).filter(item => /\/(admission|stop-all|commands\/[^/]+)$/.test(item.path));
      expect(relevant.map(item => [item.method, item.path, item.body])).toEqual([
        ['GET', `${targetPath}/admission`, null],
        ['POST', `${targetPath}/stop-all`, body],
        querySession && !replay ? ['GET', `/sessions/${querySession}/commands/${body.command_id}`, null] : ['POST', `${targetPath}/stop-all`, body],
        ['GET', `${targetPath}/admission`, null],
      ]);
      return { location, requests: relevant };
    }
    const targetRun = id => targets(page).then(data => data.runs.find(value => value.interaction_session_id === id));
    const stopB = (generation, image, replay) => stop('会话「合成对照会话」的更多操作', '停止本会话全部任务',
      `/sessions/${otherSession.id}`, generation, otherSession.id, '合成验收项目 · 合成对照会话', image, replay);
    const sessionCheck = await stopB(8, '1000x720-session-b-check.png');
    expect(await targetRun(otherSession.id)).toMatchObject({ state: 'cancelled', reason: 'stop_all' });
    const sessionRetry = await stopB(9, '1000x720-session-b-retry.png', true);
    expect(await targetRun(session.id)).toEqual(initialRuns[0]);
    const crossWorkspace = await stop('项目「异项目」的更多操作', '停止本项目全部任务', `/workspaces/${otherWorkspace.id}`, 13,
      null, '异项目', '1000x720-other-project-retry.png');
    expect(await targetRun(remoteSession.id)).toMatchObject({ state: 'cancelled', reason: 'stop_all' });
    expect(await targetRun(session.id)).toEqual(initialRuns[0]);
    await expect(page.getByRole('region', { name: '持久对话' })).toContainText('运行中');
    await expect(page.getByRole('region', { name: '持久对话' })).not.toContainText('已取消');
    const ownWorkspace = await stop('项目「合成验收项目」的更多操作', '停止本项目全部任务', `/workspaces/${workspace.id}`, 12,
      null, '合成验收项目', '1000x720-own-project-retry.png');
    expect(await targetRun(session.id)).toMatchObject({ state: 'cancelled', reason: 'stop_all' });
    await taskEntry(page).click();
    await expect(page.getByRole('region', { name: '会话任务' }).getByRole('button', { name: /合成会话的任务.*已取消/ })).toBeVisible();
    await expect(page.getByRole('region', { name: '会话任务' }).getByRole('button', { name: /合成对照会话/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(input(page)).toHaveValue(draft);
    expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
    return { sessionCheck, sessionRetry, crossWorkspace, ownWorkspace, receipts: (await targets(page)).stopReceipts };
  } finally { await page.close(); }
}

async function verifyInteraction(width, kind) {
  const page = await openPage(width, kind, 'interaction');
  const prefix = `${width}x720-${kind}`;
  const detailRole = width >= 1200 && kind === 'main' ? 'complementary' : 'dialog';
  const detail = page.getByRole(detailRole, { name: '任务详情', exact: true });
  const [questionButton, approvalButton] = ['回答任务问题并返回草稿', '处理任务审批并返回草稿'];
  try {
    const { questions: [question], approvals: [approval], runs: [run] } = await targets(page);
    await input(page).fill(draft);
    async function enter(button, image) {
      await taskEntry(page).press('Enter');
      await detail.getByRole('button', { name: /资料整理员/ }).press('Enter');
      const trigger = detail.getByRole('button', { name: button, exact: true });
      await expect(trigger).toBeVisible();
      const from = (await requests(page)).length;
      if (image) {
        await trigger.focus();
        await page.screenshot({ path: join(output, `${prefix}-task-entry.png`) });
      }
      if (width === 1440) await trigger.click();
      else await trigger.press('Enter');
      await expect(detail).toHaveCount(0);
      const called = (await requests(page)).slice(from).filter(item => item.path.startsWith('/runs/'));
      expect(called.map(item => item.path)).toContain(`/runs/${run.id}`);
    }
    const questionPanel = page.getByRole('region', { name: '回答问题', exact: true });
    const approvalPanel = page.getByRole('dialog', { name: '审批本次操作', exact: true });
    await enter(questionButton, true);
    const answer = questionPanel.getByRole('textbox', { name: '回答' });
    await expect(questionPanel.getByRole('heading', { name: question.question })).toBeInViewport();
    await expect(answer).toBeFocused();
    await expect(answer).toBeInViewport();
    await page.screenshot({ path: join(output, `${prefix}-question-focus.png`) });
    await page.getByRole('button', { name: '返回原页与草稿' }).press('Enter');
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue(draft);
    expect((await requests(page)).filter(item => item.method === 'POST')).toEqual([]);

    // 两个待办仍同时存在，审批入口必须打开审批。
    await enter(approvalButton);
    await expect(questionPanel).toHaveCount(0);
    await expect(approvalPanel).toBeInViewport();
    await expect(approvalPanel.getByRole('button', { name: '关闭对话框', exact: true })).toBeFocused();
    await expect(approvalPanel).toContainText(approval.target);
    await page.screenshot({ path: join(output, `${prefix}-approval-focus.png`) });
    await approvalPanel.getByRole('button', { name: '拒绝本次操作' }).press('Enter');
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue(draft);

    await enter(questionButton);
    await expect(answer).toBeFocused();
    await page.keyboard.insertText('11 月 21 日');
    await questionPanel.getByRole('button', { name: '提交回答' }).press('Enter');
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue(draft);
    await page.keyboard.press('End');
    await page.keyboard.insertText('，可继续编辑');
    await expect(input(page)).toHaveValue(`${draft}，可继续编辑`);
    await page.screenshot({ path: join(output, `${prefix}-return-draft.png`) });
    const writes = (await requests(page)).filter(item => item.method === 'POST');
    expect(writes.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: `/approvals/${approval.id}/decision`, body: { meta: { command_id: expect.stringMatching(/^[\da-f-]{36}$/), expected_version: 8 }, data: { allow: false } } },
      { path: `/questions/${question.id}/answer`, body: { meta: { command_id: expect.stringMatching(/^[\da-f-]{36}$/), expected_version: 5 }, data: { answer: '11 月 21 日' } } },
    ]);
    expect(await page.evaluate(() => window.syntheticUi.unexpectedRequests)).toEqual([]);
    return { width, kind, detailRole, run: run.id, question: question.id, approval: approval.id, writes };
  } finally { await page.close(); }
}

try {
  const results = await Promise.allSettled([verifyStops(), ...windowSizes.map(([width, kind]) => verifyInteraction(width, kind))]);
  await writeFile(join(output, 'results.json'), JSON.stringify(results.map(result => result.status === 'fulfilled' ? result.value : String(result.reason)), null, 2));
  console.log(output);
  for (const result of results) if (result.status === 'rejected') {
    process.exitCode = 1;
    console.error(result.reason);
  }
} finally { await browser.close(); }
