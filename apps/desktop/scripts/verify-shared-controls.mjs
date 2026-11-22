import { chromium, expect } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const archive = fileURLToPath(new URL('../.local/ui-evidence/', import.meta.url));
await mkdir(archive, { recursive: true });
const output = await mkdtemp(join(archive, 'shared-controls-'));
const origin = process.env.FLOWMATE_UI_ORIGIN ?? 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const submissions = page => page.evaluate(() => window.syntheticUi.requests
  .filter(({ method, path }) => method === 'POST' && /^\/sessions\/[^/]+\/runs$/.test(path))
  .map(({ body }) => body.data.text));

async function checkComposer(kind, width, keyboard) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, locale: 'zh-CN' });
  try {
    await page.goto(`${origin}/e2e/fixture.html?window=${kind}`);
    const draft = page.getByRole('textbox', { name: '消息', exact: true });
    const text = '保留附件与配置前的草稿';
    await draft.fill(text);
    const send = page.getByRole('button', { name: '发送', exact: true });
    await expect(send).toBeEnabled();
    await expect(send).toHaveAttribute('data-size', 'icon-sm');
    await expect(send).toHaveCSS('width', '32px');
    const configuration = page.getByRole('button', { name: '运行配置', exact: true });
    await expect(configuration).toHaveAttribute('type', 'button');
    await configuration.click();
    const dialog = page.getByRole('dialog', { name: '运行配置', exact: true });
    const assistant = dialog.getByRole('combobox', { name: '助理', exact: true });
    await assistant.focus();
    await expect(assistant).toBeInViewport();
    await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
    const metrics = await assistant.evaluate(node => {
      const style = getComputedStyle(node);
      const popup = node.closest('[role="dialog"]');
      const rect = popup.getBoundingClientRect();
      return {
        height: node.getBoundingClientRect().height, radius: style.borderRadius,
        fontSize: style.fontSize, focusWidth: style.outlineWidth, focusOffset: style.outlineOffset,
        controlDuration: style.transitionDuration, dialogDuration: getComputedStyle(popup).animationDuration,
        dialogWidth: rect.width, viewportWidth: innerWidth,
        horizontalOverflow: rect.left < 0 || rect.right > innerWidth || popup.scrollWidth > popup.clientWidth,
      };
    });
    expect(metrics).toMatchObject({
      height: 36, radius: '8px', fontSize: '13px', focusWidth: '2px', focusOffset: '2px',
      dialogDuration: '0.18s', viewportWidth: width, horizontalOverflow: false,
    });
    await page.screenshot({ path: join(output, `${kind}-${width}-settings.png`), animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(assistant).toHaveCSS('transition-duration', '0s');
    await expect(dialog).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(configuration).toBeFocused();
    await expect(draft).toHaveValue(text);
    expect(await submissions(page)).toEqual([]);

    const attachment = page.getByRole('button', { name: '选择文本文件', exact: true });
    await expect(attachment).toHaveAttribute('type', 'button');
    await attachment.click();
    const remove = page.getByRole('button', { name: /移除.*附件/ }).first();
    await expect(remove).toBeVisible();
    await expect(draft).toHaveValue(text);
    expect(await submissions(page)).toEqual([]);
    await page.screenshot({ path: join(output, `${kind}-${width}-attachment.png`), animations: 'disabled' });
    await remove.click();
    await expect(send).toBeEnabled();
    if (keyboard) await draft.press('Enter');
    else await send.click();
    await expect.poll(() => submissions(page)).toEqual([text]);
    await expect(draft).toHaveValue('');
    return { kind, width, send: keyboard ? 'Enter' : 'click', metrics };
  } finally {
    await page.close();
  }
}

async function checkQuestion(kind, width) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, locale: 'zh-CN' });
  try {
    await page.goto(`${origin}/e2e/fixture.html?window=${kind}&task2=interaction`);
    await page.locator('.conversation-detail-rail').getByRole('button', { name: '任务', exact: true }).press('Enter');
    const detail = page.getByRole('dialog', { name: '任务详情' });
    await detail.getByRole('button', { name: /资料整理员/ }).press('Enter');
    await detail.getByRole('button', { name: '回答任务问题并返回草稿' }).press('Enter');
    const question = page.getByRole('region', { name: '回答问题', exact: true });
    const answer = question.getByRole('textbox', { name: '回答', exact: true });
    const submit = question.getByRole('button', { name: '提交回答' });
    await expect(answer).toBeFocused();
    await expect(answer).toBeInViewport();
    await submit.press('Enter');
    await expect(answer).toHaveAttribute('aria-invalid', 'true');
    await expect(question.getByRole('alert')).toHaveText('文本长度超出范围');
    await answer.focus();
    await expect(answer).toHaveCSS('outline-color', 'rgb(164, 45, 60)');
    await page.screenshot({ path: join(output, `${kind}-${width}-question-invalid.png`), animations: 'disabled' });
    await answer.fill('11 月 21 日');
    await submit.press('Enter');
    await expect(question).toHaveCount(0);
    const writes = await page.evaluate(() => window.syntheticUi.requests
      .filter(({ method, path }) => method === 'POST' && path.endsWith('/answer'))
      .map(({ body }) => body.data.answer));
    expect(writes).toEqual(['11 月 21 日']);
    return { kind, width, submittedAnswer: writes[0] };
  } finally {
    await page.close();
  }
}

async function checkChoiceQuestion(kind, width, role) {
  const page = await browser.newPage({ viewport: { width, height: 720 }, locale: 'zh-CN' });
  try {
    await page.goto(`${origin}/e2e/fixture.html?window=${kind}&task2=interaction&question-choice=${role}`);
    const draft = page.getByRole('textbox', { name: '消息', exact: true });
    await draft.fill('保留当前聊天草稿');
    const { questions: [target] } = await page.evaluate(() => window.syntheticUi.task2Targets());
    const taskList = page.locator('.conversation-detail-rail').getByRole('button', { name: '任务', exact: true });
    const detail = page.getByRole('dialog', { name: '任务详情' });
    const question = page.getByRole('region', { name: '回答问题', exact: true });
    const first = question.getByRole(role, { name: '周四' });
    const second = question.getByRole(role, { name: '周五' });

    async function openQuestion() {
      await taskList.press('Enter');
      await detail.getByRole('button', { name: /资料整理员/ }).press('Enter');
      await detail.getByRole('button', { name: '回答任务问题并返回草稿' }).press('Enter');
      await expect(detail).toHaveCount(0);
      await expect(question.getByRole('heading', { name: target.question })).toBeVisible();
      await expect(first).toBeFocused();
    }

    await openQuestion();
    await expect(question.locator('input[aria-hidden="true"]').first()).toBeAttached();
    await page.keyboard.press(role === 'radio' ? 'ArrowRight' : 'Space');
    await expect(role === 'radio' ? second : first).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(question.getByRole('button', { name: '展开待办' })).toBeFocused();
    await expect(first).toBeHidden();
    await page.getByRole('button', { name: '返回原页与草稿' }).press('Enter');
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('保留当前聊天草稿');
    expect(await page.evaluate(() => window.syntheticUi.requests.filter(({ method }) => method === 'POST'))).toEqual([]);

    await openQuestion();
    await expect(role === 'radio' ? second : first).toBeChecked();
    await question.getByRole('button', { name: '提交回答' }).press('Enter');
    await expect(draft).toBeFocused();
    await expect(draft).toHaveValue('保留当前聊天草稿');
    const [write, ...extraWrites] = await page.evaluate(() => window.syntheticUi.requests.filter(({ method }) => method === 'POST'));
    expect(extraWrites).toEqual([]);
    expect(write).toMatchObject({ path: `/questions/${target.id}/answer`, body: {
      meta: { expected_version: target.version },
      data: { answer: role === 'radio' ? '周五' : ['周四'] },
    } });
    return { kind, width, role };
  } finally {
    await page.close();
  }
}

try {
  const choiceQuestions = [await checkChoiceQuestion('main', 1000, 'radio'), await checkChoiceQuestion('quick', 520, 'checkbox')];
  if (process.argv.includes('--background-question-focus')) {
    console.log(JSON.stringify({ edge: browser.version(), choiceQuestions }));
  } else {
    const composer = [
      await checkComposer('main', 1000, false),
      await checkComposer('quick', 520, true),
    ];
    const questions = [await checkQuestion('main', 1000), await checkQuestion('quick', 520)];
    await writeFile(join(output, 'results.json'), `${JSON.stringify({
      capturedAt: new Date().toISOString(),
      edge: browser.version(),
      origin,
      composer,
      questions,
      choiceQuestions,
    }, null, 2)}\n`);
    console.log(output);
  }
} finally {
  await browser.close();
}
