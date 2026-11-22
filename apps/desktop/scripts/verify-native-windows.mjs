// 仅 Windows。在 apps/desktop 构建前端和独立 debug 宿主，并运行本脚本。
// npm run build
// $env:TAURI_CONFIG = '{"identifier":"dev.flowmate.window-regression"}'
// cargo build --manifest-path src-tauri/Cargo.toml --locked --features tauri/custom-protocol
// node scripts/verify-native-windows.mjs
// 拼音专项另设 $env:FLOWMATE_VERIFY_PINYIN = '1'，按控制台提示使用实体键盘。
// 验收已装配的 release 宿主时传入同一独立标识的 exe 路径，旁边保留 runtime 目录。
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = join(desktop, '..', '..');
const python = join(root, '.venv', 'Scripts', 'python.exe');
const packaged = process.argv[2] ? resolve(process.argv[2]) : null;
const executable = packaged ?? (process.env.FLOWMATE_NATIVE_DEBUG_EXE
  ? resolve(process.env.FLOWMATE_NATIVE_DEBUG_EXE)
  : join(desktop, 'src-tauri', 'target', 'debug', 'flowmate-desktop.exe'));
const candidate = process.env.FLOWMATE_P46_CANDIDATE;
if (candidate !== undefined) assert.match(candidate, /^p46-[a-z0-9]+(?:-[a-z0-9]+)*$/);
const dataTarget = process.env.FLOWMATE_NATIVE_DATA_TARGET;
if (dataTarget) {
  assert.match(candidate, /^p46-[a-f0-9]{8}$/);
  assert.notEqual(candidate, 'p46-375174e4', '拒绝 Chen 使用中的实例');
  assert(packaged, '独立候选须使用冻结宿主');
  assert.equal(resolve(dataTarget), join(dirname(dirname(packaged)), 'temp', 'context-native', 'appdata'));
  assert.match(resolve(dataTarget), /^E:\\/i);
}
const identifier = candidate ? `dev.flowmate.${candidate}` : 'dev.flowmate.window-regression';
const dataRoot = join(process.env.APPDATA, identifier);
const data = join(dataRoot, 'data-v3');
const profileRoot = join(process.env.TEMP, 'opencode');
const draft = 'native window regression draft';
const session = 'Native window regression session';

const win32 = String.raw`
import ctypes as C
from ctypes import wintypes as W
import json, sys, time

user = C.WinDLL('user32')
user.GetForegroundWindow.restype = W.HWND
user.GetWindow.restype = W.HWND
user.GetWindow.argtypes = [W.HWND, W.UINT]
user.SendMessageW.restype = W.LPARAM
user.SendMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
user.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
user.GetMenuItemCount.argtypes = [W.HMENU]
user.GetMenuItemID.argtypes = [W.HMENU, C.c_int]
user.GetMenuItemID.restype = W.UINT
user.GetMenuStringW.argtypes = [W.HMENU, W.UINT, W.LPWSTR, C.c_int, W.UINT]
user.IsWindowVisible.argtypes = [W.HWND]
user.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
user.GetClassNameW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user.GetWindowLongW.argtypes = [W.HWND, C.c_int]
user.SetThreadDpiAwarenessContext.argtypes = [W.HANDLE]
user.SetThreadDpiAwarenessContext(W.HANDLE(-4))
pid = int(sys.argv[1])
windows = {}
foreground = user.GetForegroundWindow()
@C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
def collect(hwnd, _):
    owner_pid = W.DWORD()
    user.GetWindowThreadProcessId(hwnd, C.byref(owner_pid))
    if owner_pid.value != pid:
        return True
    title = C.create_unicode_buffer(128)
    kind = C.create_unicode_buffer(128)
    user.GetWindowTextW(hwnd, title, len(title))
    user.GetClassNameW(hwnd, kind, len(kind))
    if kind.value == 'tray_icon_app':
        label = 'tray'
    elif kind.value == '#32768' and user.IsWindowVisible(hwnd):
        label = 'menu'
    elif kind.value == '#32770' and user.IsWindowVisible(hwnd):
        label = 'dialog'
    elif title.value == 'FlowMate \u6298\u7eb8\u9e1f':
        label = 'ball'
    elif title.value == 'FlowMate':
        label = 'main'
    elif title.value.startswith('FlowMate') and title.value.endswith('\u5feb\u6377\u52a9\u7406'):
        label = 'quick'
    else:
        return True
    windows[label] = dict(hwnd=hwnd, visible=bool(user.IsWindowVisible(hwnd)),
                          focused=hwnd == foreground, owner=user.GetWindow(hwnd, 4))
    return True

user.EnumWindows(collect, 0)
if len(sys.argv) > 2:
    action = sys.argv[2]
    if action == 'place-pet':
        # 将入口放在本次隔离宿主的工作台内，取样窗口角落。
        origin = W.POINT(100, 100)
        user.ClientToScreen.argtypes = [W.HWND, C.POINTER(W.POINT)]
        assert user.ClientToScreen(windows['main']['hwnd'], C.byref(origin))
        user.SetWindowPos.argtypes = [W.HWND, W.HWND, C.c_int, C.c_int, C.c_int, C.c_int, W.UINT]
        assert user.SetWindowPos(windows['ball']['hwnd'], None, origin.x, origin.y, 0, 0, 0x0015)
    elif action == 'pet-corner':
        point = W.POINT(2, 2)
        user.ClientToScreen.argtypes = [W.HWND, C.POINTER(W.POINT)]
        assert user.ClientToScreen(windows['ball']['hwnd'], C.byref(point))
        user.WindowFromPoint.argtypes = [W.POINT]
        user.WindowFromPoint.restype = W.HWND
        user.GetAncestor.argtypes = [W.HWND, W.UINT]
        user.GetAncestor.restype = W.HWND
        assert user.GetAncestor(user.WindowFromPoint(point), 2) in (windows['main']['hwnd'], windows['ball']['hwnd'])
        user.GetDC.argtypes = [W.HWND]
        user.GetDC.restype = W.HDC
        user.ReleaseDC.argtypes = [W.HWND, W.HDC]
        sample = C.WinDLL('gdi32').GetPixel
        sample.argtypes = [W.HDC, C.c_int, C.c_int]
        sample.restype = W.DWORD
        dc = user.GetDC(None)
        try:
            color = sample(dc, point.x, point.y)
            assert color != 0xffffffff
            windows['ball']['corner'] = [color & 255, color >> 8 & 255, color >> 16 & 255]
        finally:
            user.ReleaseDC(None, dc)
    elif action.startswith('drag-pet:'):
        pet = windows['ball']['hwnd']
        _, css_x, css_y, ratio = action.split(':')
        start = W.POINT(round(float(css_x) * float(ratio)), round(float(css_y) * float(ratio)))
        user.ClientToScreen.argtypes = [W.HWND, C.POINTER(W.POINT)]
        user.WindowFromPoint.argtypes = [W.POINT]
        user.WindowFromPoint.restype = W.HWND
        user.GetAncestor.argtypes = [W.HWND, W.UINT]
        user.GetAncestor.restype = W.HWND
        user.GetWindowRect.argtypes = [W.HWND, C.POINTER(W.RECT)]
        assert user.ClientToScreen(pet, C.byref(start))
        assert user.GetAncestor(user.WindowFromPoint(start), 2) == pet, '桌宠未处于测试鼠标位置'
        original, before, after = W.POINT(), W.RECT(), W.RECT()
        assert user.GetCursorPos(C.byref(original)) and user.GetWindowRect(pet, C.byref(before))
        prior_focus = user.GetForegroundWindow()
        try:
            assert user.SetCursorPos(start.x, start.y)
            user.mouse_event(0x0002, 0, 0, 0, 0)
            for delta in (2, 8, 16, 28, 44):
                time.sleep(0.08)
                assert user.SetCursorPos(start.x + delta, start.y + delta // 2)
        finally:
            user.mouse_event(0x0004, 0, 0, 0, 0)
            user.SetCursorPos(original.x, original.y)
        assert user.GetWindowRect(pet, C.byref(after))
        windows['ball']['moved'] = [after.left - before.left, after.top - before.top]
        windows['ball']['focusBeforeAndAfter'] = [prior_focus, user.GetForegroundWindow()]
    elif action.startswith('input-layout:'):
        _, label = action.split(':')
        target = windows[label]['hwnd']
        assert user.GetForegroundWindow() == target, '输入目标必须是本次验收的前台窗口'
        class GuiThreadInfo(C.Structure):
            _fields_ = [('size', W.DWORD), ('flags', W.DWORD),
                        *[(name, W.HWND) for name in ('active', 'focus', 'capture', 'menu', 'move', 'caret')],
                        ('caret_rect', W.RECT)]
        gui = GuiThreadInfo()
        gui.size = C.sizeof(gui)
        user.GetGUIThreadInfo.argtypes = [W.DWORD, C.POINTER(GuiThreadInfo)]
        user.IsChild.argtypes = [W.HWND, W.HWND]
        assert user.GetGUIThreadInfo(0, C.byref(gui)) and gui.focus
        assert gui.focus == target or user.IsChild(target, gui.focus), '键盘焦点不在测试窗口内'
        thread = user.GetWindowThreadProcessId(gui.focus, None)
        user.GetKeyboardLayout.argtypes = [W.DWORD]
        user.GetKeyboardLayout.restype = W.HANDLE
        windows[label]['observedLayout'] = user.GetKeyboardLayout(thread)
    elif action == 'tray':
        # tray-icon 的原生鼠标回调只发给测试宿主 HWND。
        assert user.PostMessageW(windows['tray']['hwnd'], 6002, 0, 0x0205)
    elif action.startswith('menu:'):
        hwnd = windows['menu']['hwnd']
        menu = user.SendMessageW(hwnd, 0x01E1, 0, 0) # MN_GETHMENU
        text = C.create_unicode_buffer(128)
        for index in range(user.GetMenuItemCount(menu)):
            user.GetMenuStringW(menu, index, text, len(text), 0x0400) # MF_BYPOSITION
            if text.value == action.removeprefix('menu:'):
                item_id = user.GetMenuItemID(menu, index)
                break
        else:
            raise AssertionError(f'Tray item not found: {action}')
        assert user.PostMessageW(windows['tray']['hwnd'], 0x001F, 0, 0) # WM_CANCELMODE
        assert user.PostMessageW(windows['tray']['hwnd'], 0x0111, item_id, 0) # WM_COMMAND
    else:
        assert user.PostMessageW(windows[action]['hwnd'], 0x0010, 0, 0) # WM_CLOSE
print(json.dumps(windows))
`;

function native(pid, action) {
  return JSON.parse(execFileSync(python, ['-c', win32, String(pid), ...(action ? [action] : [])], { encoding: 'utf8' }));
}

async function start(profile) {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const env = { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` };
  if (packaged) {
    delete env.FLOWMATE_DEV_PYTHON;
    delete env.FLOWMATE_DEV_ROOT;
    delete env.PYTHONPATH;
  } else {
    env.FLOWMATE_DEV_PYTHON = python;
    env.FLOWMATE_DEV_ROOT = root;
  }
  const child = spawn(executable, [], {
    env,
    stdio: 'inherit',
  });
  const exited = once(child, 'exit');
  let main;
  async function stop() {
    try {
      if (main && child.exitCode === null) await invoke(main, 'stop_runtime');
    } catch (error) {
      if (!String(error).includes('Target page, context or browser has been closed')) throw error;
    } finally {
      if (child.exitCode === null) {
        await expect.poll(() => child.exitCode, { timeout: 5_000 }).not.toBeNull().catch(() => child.kill());
        await exited;
      }
    }
  }
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    await expect.poll(async () => {
      if (child.exitCode !== null) return `host exit ${child.exitCode}`;
      try { return (await fetch(`${endpoint}/json/version`)).status; }
      catch { return 'waiting for WebView2'; }
    }, { timeout: 20_000 }).toBe(200);
    const browser = await chromium.connectOverCDP(endpoint);
    const pages = () => browser.contexts().flatMap(context => context.pages());
    await expect.poll(() => pages().filter(page => page.url().startsWith('http://tauri.localhost/')), { timeout: 20_000 }).toHaveLength(3);
    const page = label => pages().find(candidate => (new URL(candidate.url()).searchParams.get('window') ?? 'main') === label);
    main = page('main');
    for (const candidate of pages()) candidate.setDefaultTimeout(7_000);
    return { child, main, quick: page('quick'), ball: page('ball'), stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

const invoke = (page, command, args) => page.evaluate(
  ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args },
);
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function visibility(app, step, main, quick, ball) {
  await expect.poll(() => {
    const state = native(app.child.pid);
    return [state.main?.visible, state.quick?.visible, state.ball?.visible];
  }, { message: `${step} [main, quick, ball]`, timeout: 2_500 }).toEqual([main, quick, ball]);
  console.log(`${step}: ${[main, quick, ball].join(', ')}`);
}

async function focused(app, label) {
  await expect.poll(() => native(app.child.pid)[label]?.focused, { message: `${label} native focus` }).toBe(true);
}

async function openTrayMenu(app) {
  native(app.child.pid, 'tray');
  await expect.poll(() => native(app.child.pid).menu?.visible).toBe(true);
}

const manualInputTimeout = 45_000;

async function verifyPinyinEscape(app, label, input, original, evidenceDir) {
  await focused(app, label);
  await input.focus();
  await expect(input).toBeFocused();
  const layout = () => native(app.child.pid, `input-layout:${label}`)[label].observedLayout;
  const initialLayout = layout();
  await input.fill(original);
  const observer = await input.evaluateHandle(node => {
    node.setSelectionRange(node.value.length, node.value.length);
    const events = [];
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const record = event => events.push({
      type: event.type,
      trusted: event.isTrusted,
      data: event.type.startsWith('composition') ? event.data : undefined,
      inputType: event.inputType,
    });
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input', 'blur'])
      node.addEventListener(type, record, options);
    for (const type of ['keydown', 'keyup'])
      node.addEventListener(type, event => {
        if (event.code === 'Escape') events.push({ type, key: event.key, composing: event.isComposing, trusted: event.isTrusted });
      }, options);
    window.addEventListener('blur', () => events.push({ type: 'window-blur' }), options);
    return { controller, events, node };
  });
  const snapshot = () => observer.evaluate(({ events, node }) => ({
    events,
    focused: node === document.activeElement && document.hasFocus(),
    value: node.value,
  }));
  const readEvents = async () => (await snapshot()).events;
  const startIndex = items => items.findIndex(item => item.type === 'compositionstart' && item.trusted);
  let observedLayout;
  let passed = false;
  try {
    const title = label === 'quick' ? '快捷助理' : '新建长期记忆';
    console.log(`【${title}】当前编辑框已有测试草稿。请选 Microsoft 拼音，确认任务栏显示「中」后在框内键入 ce。看到系统候选后按一次 Esc，留在编辑框等待。`);
    await expect.poll(async () => startIndex(await readEvents()) >= 0,
      { timeout: manualInputTimeout, message: `${label} 未观察到 Microsoft 拼音组合开始` }).toBe(true);
    await expect.poll(async () => {
      const items = await readEvents();
      return items.slice(startIndex(items) + 1).some(item => item.type === 'compositionend');
    }, { timeout: manualInputTimeout, message: `${label} 未观察到 Esc 结束组合` }).toBe(true);
    const items = await readEvents();
    const cycle = items.slice(startIndex(items));
    const end = cycle.findIndex(item => item.type === 'compositionend');
    const updates = cycle.slice(1, end);
    assert(updates.some(item => item.type === 'compositionupdate' && item.trusted && item.data), `${label} 没有观察到预编辑内容`);
    // WebView2 取消这轮组合时可能把 compositionend 标为不可信。用同一轮的原生 Esc 和清空操作佐证。
    if (!cycle[end].trusted) {
      const escape = updates.findIndex(item => item.type === 'keydown' && item.trusted && item.composing);
      assert(escape >= 0 && updates.slice(escape + 1).some(item => item.type === 'compositionupdate' && item.trusted && item.data === ''),
        `${label} 缺少与组合取消相符的原生 Esc 和清空事件`);
    }
    assert(!cycle.some(item => item.type === 'blur' || item.type === 'window-blur'), `${label} 组合开始后焦点离开了原输入框`);
    observedLayout = layout();
    assert.equal(observedLayout & 0xffff, 0x0804, `${label} 应使用简体中文输入布局`);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(original);
    if (label === 'main') await expect(button(app.main, '放弃更改')).toHaveCount(0);
    passed = true;
    console.log(`${label} Windows Pinyin Escape kept the draft and focus`);
  } finally {
    await observer.evaluate(({ controller }) => controller.abort());
    const evidence = { label, original, initialLayout, observedLayout, passed, ...await snapshot() };
    const output = join(evidenceDir, `${label}-pinyin.json`);
    writeFileSync(output, JSON.stringify(evidence, null, 2));
    console.log(`${label} 拼音证据 ${output}`);
    await observer.dispose();
  }
}

assert(readFileSync(executable).includes(Buffer.from(identifier)), '需要使用验收专用标识构建的宿主');
if (packaged) {
  for (const input of [executable, join(dirname(packaged), 'runtime', 'flowmate-runtime.exe')])
    console.log(`${basename(input)} ${createHash('sha256').update(readFileSync(input)).digest('hex')} ${input}`);
}
async function verifyNativeWindows(profile) {
  let app = await start(profile);
  try {
    await visibility(app, 'new install', true, false, false);
    await invoke(app.main, 'set_ball_enabled', { enabled: true });
    await visibility(app, 'enable ball from workbench', true, false, true);
    await app.main.bringToFront();
    native(app.child.pid, 'place-pet');
    const backgrounds = [];
    for (const theme of ['dark', 'light']) {
      await invoke(app.main, 'set_ball_enabled', { enabled: false });
      await button(app.main, '设置').click();
      const settings = app.main.getByRole('dialog', { name: '设置', exact: true });
      await button(settings, '外观与主题').click();
      await button(settings, theme === 'dark' ? '切换到深色' : '切换到浅色').click();
      await button(settings, '完成').click();
      await expect(app.main.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(app.quick.locator('html')).toHaveAttribute('data-theme', theme);
      const rgb = native(app.child.pid, 'pet-corner').ball.corner;
      backgrounds.push(rgb);
      await invoke(app.main, 'set_ball_enabled', { enabled: true });
      await visibility(app, `pet above ${theme} workbench`, true, false, true);
      await expect.poll(() => native(app.child.pid, 'pet-corner').ball.corner,
        { message: '伙伴轮廓外能看见后方工作台的实际底色' }).toEqual(rgb);
    }
    assert.notDeepEqual(backgrounds[0], backgrounds[1], '前后两次验收应使用可区分的实际底色');
    const petPictures = join(desktop, '.local', 'ui-evidence');
    mkdirSync(petPictures, { recursive: true });
    const petOutput = mkdtempSync(join(petPictures, 'native-pet-'));
    await app.ball.screenshot({ path: join(petOutput, 'idle.png'), omitBackground: true });
    console.log(`pet transparent on two native backgrounds: ${petOutput}`);
    const pet = app.ball.getByRole('button');
    await expect(pet).toHaveCount(1);
    await expect(pet).toHaveAccessibleName(/快捷/);
    const petPoint = await pet.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      return [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, devicePixelRatio];
    });
    const { moved, focusBeforeAndAfter } = native(app.child.pid, `drag-pet:${petPoint.join(':')}`).ball;
    assert(moved[0] >= 10 && moved[1] >= 4, `原生拖动后的位置变化为 ${moved}`);
    await visibility(app, 'drag pet without opening quick', true, false, true);
    assert.ok(focusBeforeAndAfter[0], '拖动前应有前台窗口');
    assert.equal(focusBeforeAndAfter[1], focusBeforeAndAfter[0], '移动桌宠时应保留之前的前台窗口');
    await pet.click();
    await visibility(app, 'ball clicked with workbench open', false, true, true);
    await focused(app, 'quick');
    await button(app.quick, '打开项目导航').click();
    await button(app.quick, '新建会话').click();
    await app.quick.getByRole('dialog', { name: '新建会话' }).getByRole('textbox').fill(session);
    await button(app.quick, '创建会话').click();
    const sessionHeading = app.quick.getByRole('heading', { name: session, exact: true });
    await expect(sessionHeading).toBeVisible();
    const filePicker = button(app.quick, '选择文本文件');
    await filePicker.click();
    await expect.poll(() => {
      const state = native(app.child.pid);
      return state.dialog?.owner === state.quick?.hwnd;
    }, { message: 'native file dialog is owned by quick' }).toBe(true);
    await visibility(app, 'unpinned quick during native file dialog', false, true, true);
    native(app.child.pid, 'dialog');
    await expect.poll(() => native(app.child.pid).dialog).toBeUndefined();
    await expect(filePicker).toBeEnabled();
    await focused(app, 'quick');
    await button(app.quick, '置顶小窗').click();
    await app.quick.locator('#message-input').fill(draft);
    if (process.env.FLOWMATE_VERIFY_PINYIN === '1')
      await verifyPinyinEscape(app, 'quick', app.quick.locator('#message-input'), draft, petOutput);
    await button(app.quick, '展开工作台').click();
    await visibility(app, 'expand pinned quick with draft', true, false, true);
    await focused(app, 'main');
    if (process.env.FLOWMATE_VERIFY_PINYIN === '1') {
      await app.main.getByRole('button', { name: /记忆与成长/ }).click();
      await button(app.main, '更多记忆管理').click();
      await app.main.getByRole('menuitem', { name: '新建记忆' }).click();
      const editor = app.main.getByRole('textbox', { name: '新记忆内容' });
      await verifyPinyinEscape(app, 'main', editor, '未提交的记忆草稿', petOutput);
      console.log('【新建长期记忆】草稿和焦点已核对，请再按一次实体 Esc。');
      await expect(button(app.main, '放弃更改')).toBeVisible({ timeout: manualInputTimeout });
      await button(app.main, '放弃更改').click();
      await expect(button(app.main, '更多记忆管理')).toBeFocused();
      await button(app.main, '返回对话与草稿').click();
    }
    await button(app.main, '返回快捷小窗').click();
    await visibility(app, 'return to quick', false, true, true);
    await focused(app, 'quick');
    await expect(sessionHeading).toBeVisible();
    await expect(app.quick.locator('#message-input')).toHaveValue(draft);
    await button(app.quick, '取消置顶').click();
    await button(app.quick, '打开项目导航').click();
    await button(app.quick, '设置').click();
    await visibility(app, 'open settings from unpinned quick with draft', true, false, true);
    await focused(app, 'main');
    const settings = app.main.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings).toBeVisible();
    await expect(button(settings, '连接与模型')).toHaveAttribute('aria-pressed', 'true');
    await expect(button(settings, '新建连接')).toBeVisible();
    await button(settings, '返回快捷小窗').click();
    await visibility(app, 'return from settings', false, true, true);
    await focused(app, 'quick');
    await expect(app.quick.locator('#message-input')).toHaveValue(draft);
    await button(app.quick, '隐藏快捷小窗').click();
    await visibility(app, 'collapse quick', false, false, true);
    await openTrayMenu(app);
    native(app.child.pid, 'menu:显示主窗口');
    await visibility(app, 'explicit workbench entry from tray', true, false, true);
    await openTrayMenu(app);
    native(app.child.pid, 'menu:快捷助理');
    await visibility(app, 'tray quick while workbench open', false, true, true);
    await openTrayMenu(app);
    await visibility(app, 'unpinned quick with draft stays visible on blur', false, true, true);
    native(app.child.pid, 'menu:显示主窗口');
    await visibility(app, 'tray workbench while quick open', true, false, true);
    native(app.child.pid, 'main');
    await visibility(app, 'native main close', false, false, true);
    await pet.click();
    await visibility(app, 'reopen quick before native close', false, true, true);
    native(app.child.pid, 'quick');
    await visibility(app, 'native quick close', false, false, true);
    await pet.click();
    await expect(app.quick.locator('#message-input')).toHaveValue(draft);
    await app.quick.locator('#message-input').fill('');
    await openTrayMenu(app);
    await visibility(app, 'unpinned quick without a draft hides on blur', false, false, true);
    native(app.child.pid, 'menu:设置');
    await visibility(app, 'tray settings', true, false, true);
  } finally {
    await app.stop();
  }

  app = await start(profile);
  try {
    await visibility(app, 'restart with saved ball enabled', false, false, true);
  } finally {
    await app.stop();
  }

  writeFileSync(join(data, 'window-settings.json'), JSON.stringify({ quick_pinned: false, ball_enabled: false, shortcut: null }));
  app = await start(profile);
  try {
    await visibility(app, 'restart with explicitly disabled ball', true, false, false);
  } finally {
    await app.stop();
  }
}

if (dataTarget) {
  mkdirSync(dataTarget);
  // Tauri 使用 Windows Known Folder。仅在新标识下放联接，实际文件留在 E 盘。
  symlinkSync(dataTarget, dataRoot, 'junction');
} else {
  mkdirSync(dataRoot); // 已有目录时立即停止，避免触碰另一实例或原有数据。
}
let profile;
try {
  if (dataTarget) assert.equal(realpathSync(dataRoot), realpathSync(dataTarget));
  mkdirSync(profileRoot, { recursive: true });
  profile = mkdtempSync(join(profileRoot, 'flowmate-window-regression-'));
  const scenario = process.env.FLOWMATE_NATIVE_SCENARIO;
  if (scenario) {
    const { verify } = await import(pathToFileURL(resolve(scenario)).href);
    await verify({ start: () => start(profile), data, native, focused, visibility, openTrayMenu, button, expect, executable, packaged, python });
  } else {
    await verifyNativeWindows(profile);
  }
} finally {
  try {
    if (dataTarget) {
      assert(lstatSync(dataRoot).isSymbolicLink());
      assert.equal(realpathSync(dataRoot), realpathSync(dataTarget));
      unlinkSync(dataRoot);
      await rm(dataTarget, { recursive: true, maxRetries: 8, retryDelay: 150 });
    } else {
      rmSync(dataRoot, { recursive: true });
    }
  } finally {
    if (profile) await rm(profile, { recursive: true, maxRetries: 8, retryDelay: 150 });
  }
}
