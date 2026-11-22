# 桌面窗口与真实 MCP 的离线联合验收

在项目根目录执行：

```powershell
Push-Location apps/desktop
node node_modules/vitest/vitest.mjs run integration/McpMarkerWindow.test.tsx --reporter=verbose
Pop-Location
```

前提是现有 `.venv` 与 `apps/desktop/node_modules` 已安装；不需要供应商凭据。

用例分别以 `?window=main`、`?window=quick` 渲染正式 `App`，通过真实表单创建会话、发送一次消息。
React 运行在既有 integration 模式的 jsdom 中；此用例不验收原生 WebView 的布局或 Tauri IPC。
仅合成窗口宿主 IPC、测试秘密和离线外部模型传输。RuntimeClient、HTTP/SSE、
SQLite、Scheduler、本机 stdio MCP 进程及实际模型 SDK 序列化均使用产品实现。

每种窗口单独建立临时数据目录，先保存/发现启用的 MCP，再停止并重新构建 Runtime。
不固定工具选择、不创建 grant、不注入工具回执或 UI 答复，不访问外部 Live 服务。
模型只解析当前实际 SDK 请求：首轮请求工具，第二轮从序列化的工具回执读取随机标记，
本机 MCP 仅在实际 `tools/call` 时生成标记。

模型首轮等待由夹具放行，用于先断言窗口已通过实际 SSE 展示“本轮活动”；
放行不修改产品业务状态。随后断言工具卡片“已返回”，展开可见随机标记，
且最终答复只出现一次。HTTP 与 SQLite 断言补充验证一个 Run、一次工具派发、
一次 MCP 调用、两次 SDK 请求、无审批与 grant。

终端分别输出 `main`、`quick` 的证据目录，位于
`C:/Users/Chen/AppData/Local/Temp/opencode/flowmate-mcp-marker-window-*`：

- `ui-active.html`：模型首轮等待期间的正式 App DOM。
- `ui-completed.html`、`ui-last.html`：最终及最后观察的 DOM。
- `window-evidence.json`：窗口、答复、真实请求记录、RunDetail、消息。
- `window-requests.json`：包括失败场景在内的本次真实 HTTP 请求记录。
- `model-requests.json`：实际 SDK 发给离线模型的两次请求。
- `remote/receipts.jsonl`：独立 stdio MCP 进程生成的发现/调用审计。
- `sqlite-audit.json`：真实数据库中的 Run、活动、消息及持久事件，只读取证。
- `server-stderr.log`：本次 Runtime 夹具诊断。
- `runtime/`：隔离产品数据库与相关数据。

测试不修改产品源代码，不写共享夹具、不提交 Git，也不自动删除复验证据。

活动观察上限为 45 秒，单窗总上限为 120 秒；这不是响应延迟指标。
本机一次运行中 `run.started` 到 `activity.prepared` 约 15 秒，
原 10 秒观察上限因此出现过一次 main 红测；对应证据目录保留。
另一项早期红测来自验收断言误把 SQLite 活动当成 HTTP `ActivityView`，
已按持久层的 `intent.kind`、事件 `payload.activities` 修正。

仓库现有 `.gitignore` 忽略整个 `/tests/`，Python 夹具仍保存在上述本机路径；
复制此用例复验时需要一并保留 `tests/m2/mcp_marker_window_ui_server.py`。

## 本机验收记录

2026-11-20 19:21 的完整复验：`1 passed` 测试文件、`2 passed` 用例，总耗时 52.75 秒。

| 窗口 | 独立 MCP 随机标记 | 证据目录后缀 |
| --- | --- | --- |
| main | `M2-f39bfbcd08974b9fba7c8845358e9227` | `flowmate-mcp-marker-window-wja7x8jg` |
| quick | `M2-ca1e9acb93a889869f8be98c582c40b0` | `flowmate-mcp-marker-window-gbs2cin5` |

两窗均核对：活动 DOM 存在、最终答复在完成 DOM 中恰好一次、Run 完成、
SDK 请求两次、首轮无标记而续轮有标记、MCP 调用及 SQLite 工具派发各一次、
grant/审批均为零、Runtime stderr 为空。未发现需要修改产品实现的问题。

之前的 main 10 秒观察超时证据保留在 `flowmate-mcp-marker-window-4wekn64b`；
该次 `run.started` 为 `11:19:20.675Z`，`activity.prepared` 为 `11:19:35.520Z`。
该目录的 Proactor traceback 出现在失败后的 HTTP 关闭阶段；
完整通过的两次窗口执行均没有该诊断。
