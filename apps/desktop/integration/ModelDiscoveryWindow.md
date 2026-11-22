# 第二批首项：独立离线联合验收

依据 `docs/superpowers/plans/2026-11-20-m2-remediation-batch-two.md` 首项。
只新增测试与夹具，不修改生产文件，不访问 Live。

## 执行

从 `apps/desktop` 执行：

```powershell
npm test -- integration/ModelDiscoveryWindow.test.tsx
```

从仓库根目录执行夹具的独立后端复现：

```powershell
.venv/Scripts/python.exe -m pytest tests/m2/test_model_discovery_window_fixture.py -q --basetemp=.local/model-discovery-window-fixture
.venv/Scripts/python.exe -m ruff check tests/m2/model_discovery_window_ui_server.py tests/m2/test_model_discovery_window_fixture.py
```

主验收使用正式 `App`、设置弹窗、连接表单、型号表单和聊天输入。
从空连接、空型号开始，输入自定义前缀下的完整 Chat Completions URL 和一份合成 Key。
正式 UI 保存凭据后发起只读发现；本机网关分两页只返回 ID，不提供容量或能力。
用户分别选择 `GPT-FlowMate-custom-A` 和 `Claude-FlowMate-custom-B`，保存到同一连接。
关闭设置后聊天模型列表自动同步，同一会话分别选择两个型号并点击发送。

Runtime、HTTP/SSE、SQLite、Scheduler、ModelGateway 和锁定 SDK 保持真实。
宿主的系统凭据存储由测试模拟；正式 `save_credential` IPC 的绑定经真实连接记录核对后，
才允许实际 `HostSecrets` 通过 `HostChannel` 解析同一 Key。
独立后端复现还验证未保存 Key、端点/协议/ref/版本不匹配时均被拒绝。
浏览器 fetch 只允许夹具 Runtime；模型与发现传输只允许该次夹具的本机网关，
其底层保留真实 TCP/HTTP。测试不注入成功 UI，不改默认助理工具，不预填模型容量或能力。

## 2026-11-20 首次运行的断点

已实测通过：正式 UI 保存一个连接、一份 Key，实际网关两次 GET（第二次包含正确 `after` 游标），
选择保存两个原始别名，两个 Profile 均无容量与能力覆盖，聊天自动同步并提交两个 Run。

未通过：两个 Run 均为 `failed / tool_unavailable`，各有一次失败模型活动；
模型请求预算计数均为 0，网关推理 POST 为 0。不能宣称已验证实际 SDK `request.model`。

失败证据目录：

`C:\Users\Chen\AppData\Local\Temp\opencode\flowmate-model-discovery-window-w8ep_ndp`

关键文件：

- `window-evidence.json`：连接、两个 Profile、两个真实 RunDetail、正式 UI 发出的 HTTP。
- `run-GPT-FlowMate-custom-A.json`、`run-Claude-FlowMate-custom-B.json`：各轮终态及活动。
- `gateway-receipts.json`：只有两次 GET，无推理请求。
- `credential-receipts.json`：仅一次保存及后继解析的完整绑定、合成 Key SHA-256。
- `tool-projection-differences.json`：两轮唯一不同的工具都是 `skills.run_script`，
  差异字段为 `description`、`input_schema`，且注册项存在 `model_spec`。
- `sqlite-audit.json`、`ui-last.html`、`acceptance-stage.json`、`server-stderr.log`。

生产代码断点：`packages/flowmate/agents/executor.py` 在构建请求工具时调用 `BoundTool.model_spec`；
`packages/flowmate/skills/execution/service.py` 将内部执行 DTO 投影为面向模型的参数 Schema。
`packages/flowmate/models/direct.py` 的 `ModelGateway.stream` 随后仍要求请求 ToolSpec 与内部
`catalog.get(...).spec` 完全相等，因而在实际网络派发前返回 `tool_unavailable`。
保持失败交由生产代码负责人处理；不得通过删除该工具、预设能力或放宽测试断言获得通过。

修复后重跑同一命令，应核对两次实际 POST 的 URL 均为 UI 保存的完整 URL，
`body.model` 顺序为上述两个原始 ID，鉴权均使用同一合成 Key，
每个 Run 完成且只发一次模型请求；第二轮 SDK 输入保留第一轮答复，桌面每轮答复只显示一次。

当前只覆盖主窗 jsdom 宿主模拟与离线网关，未覆盖 WebView2、真实系统凭据存储和 Live。

定向结果：UI 联合验收失败，独立后端复现同样失败于 `tool_unavailable`；
两个 Python 新文件 Ruff 检查通过。针对新增 integration 的 TypeScript 检查未报告该文件错误，
但被当前生产文件 `ArtifactPanel.tsx:35` 的图片媒体类型联合类型，以及
`VisionContinuation.tsx:28` 的能力类型转换错误阻断。未执行全套回归。

仓库 `.gitignore:30` 当前忽略 `/tests/`，所以两个新增 Python 文件虽已落盘，
不会出现在普通 `git status`。本任务不修改忽略规则或索引；主审纳入提交时需显式
`git add -f tests/m2/model_discovery_window_ui_server.py tests/m2/test_model_discovery_window_fixture.py`。

## 修复后复验

`ModelGateway` 按当前任务发布给模型的工具定义校验请求。2026-11-20 使用 `node node_modules/vitest/vitest.mjs run integration/ModelDiscoveryWindow.test.tsx --maxWorkers 1` 重跑正式窗口用例，1 项通过。

用户在同一连接保存一次 Key，通过两页目录选择 `GPT-FlowMate-custom-A` 和 `Claude-FlowMate-custom-B`。同一会话的两轮聊天各发送一次 POST，实际请求中的 `model` 按选择顺序保留了两个别名。两轮均完成，第二轮带上了第一轮的答复。
