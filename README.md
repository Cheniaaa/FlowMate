# FlowMate

FlowMate 是一个模块化个人 AI 助理与桌面工作台，使用 Python、Tauri 和 React 构建。

## 运行方式

以下步骤适用于 Windows x64，使用 PowerShell 执行。

### 环境准备

- Python 3.13 和 [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Node.js 22.12 或更高版本（含 npm）
- Rust stable（MSVC 工具链）
- Microsoft C++ Build Tools，勾选“使用 C++ 的桌面开发”
- Microsoft Edge WebView2 Runtime

Windows 原生依赖的安装说明见 [Tauri 环境准备](https://v2.tauri.app/start/prerequisites/)。

### 启动

```powershell
git clone https://github.com/Cheniaaa/FlowMate.git
cd FlowMate

uv sync --locked --extra models --extra capabilities --extra knowledge

$env:FLOWMATE_DEV_ROOT = (Get-Location).Path
$env:FLOWMATE_DEV_PYTHON = Join-Path $env:FLOWMATE_DEV_ROOT '.venv/Scripts/python.exe'

Push-Location apps/desktop
npm.cmd ci
npm.cmd run tauri -- dev
Pop-Location
```

启动后，在应用设置中配置模型连接和模型。

支持项目资料导入、跨会话检索和来源引用。

### 冻结 Runtime

Runtime 使用 `models`、`capabilities` 和 `knowledge`。开发构建另需 `packaging` 依赖组：

```powershell
uv sync --locked --extra models --extra capabilities --extra knowledge --group packaging
uv run --locked --no-sync python scripts/build_sidecar.py --output .local/runtime
```

输出为 onedir，不执行产品安装；已有构建目录不会被覆盖。
