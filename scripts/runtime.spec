# PyInstaller 6.22.3：M2 base+models+capabilities onedir；只收集选定能力。
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH).parent
sys.path.insert(0, str(root / "scripts"))
from build_sidecar import collection_excludes, metadata_files

datas = collect_data_files("flowmate.persistence", includes=["schema.sql"])
datas += collect_data_files("flowmate.models", includes=["provider_presets.json", "model_metadata.json"])
# 当前genai-prices 0.2.1价格目录是data.py，随PYZ导入；不存在价格JSON。
datas += metadata_files()
hiddenimports = ["uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "pydantic_ai.direct",
    "pydantic_ai.models.openai", "pydantic_ai.models.anthropic", "genai_prices.data",
    "pydantic_ai.providers.openai_compatible",
    # pywin32 的 GetProcessTimes 在 native 层延迟导入时区，静态 Analysis 无法发现。
    "win32timezone"]
a = Analysis([str(root / "scripts/runtime_entry.py")], pathex=[str(root / "packages")],
    binaries=[], datas=datas, hiddenimports=hiddenimports, excludes=collection_excludes(), noarchive=False)
# 仅给实际Analysis模块补齐版本身份，不collect模块，也不按全环境installed列表打包。
for source, destination in metadata_files([name for name, _, _ in a.pure]):
    metadata_root = Path(source)
    for path in metadata_root.rglob("*"):
        if path.is_file():
            a.datas.append(((Path(destination) / path.relative_to(metadata_root)).as_posix(), str(path), "DATA"))
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="flowmate-runtime", debug=False,
    bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="flowmate-runtime")
