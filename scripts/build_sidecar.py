"""M2 base+models+capabilities onedir 与严格来源/归档核验；不读取产品配置或凭据。"""

import argparse
import ast
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import subprocess
import sys
import tomllib
from email.parser import BytesParser
from pathlib import Path, PurePosixPath

from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "bundle-manifest.json"
SELECTED_EXTRAS = ("models", "capabilities")
EXCLUDES = ["experiments", "pydantic_monty", "lancedb", "pyarrow", "fastembed",
            "onnxruntime", "onnx", "tokenizers", "torch", "transformers", "numpy", "pytest", "_pytest"]
REQUIRED_MODULES = {"flowmate", "flowmate.__main__", "flowmate.bootstrap", "pydantic_ai.direct",
                    "pydantic_ai.models.openai", "pydantic_ai.models.anthropic", "genai_prices.data",
                    "pydantic_ai.providers.openai_compatible", "win32timezone",
                    "mcp", "mcp.client.stdio", "mcp.client.streamable_http", "mcp_types", "yaml",
                    "flowmate.integrations.mcp", "flowmate.skills.packages", "flowmate.processes.windows",
                    "pywintypes", "win32con", "winerror"}
REQUIRED_COMPONENTS = {"flowmate", "pydantic-ai-slim", "genai-prices", "openai", "anthropic",
                       "mcp", "mcp-types", "pyyaml", "pywin32"}
REQUIRED_NATIVE_FILES = {
    "_internal/win32/win32api.pyd", "_internal/win32/win32event.pyd",
    "_internal/win32/win32file.pyd", "_internal/win32/win32job.pyd",
    "_internal/win32/win32pipe.pyd", "_internal/win32/win32process.pyd",
    "_internal/pywin32_system32/pywintypes313.dll",
}
REQUIRED_RESOURCES = {"_internal/flowmate/persistence/schema.sql",
                      "_internal/flowmate/models/provider_presets.json",
                      "_internal/flowmate/models/model_metadata.json"}
SOURCE_PATTERNS = ["packages/flowmate/**/*.py", "packages/flowmate/**/*.sql", "packages/flowmate/models/*.json",
                   "apps/desktop/src/**/*", "apps/desktop/scripts/*", "apps/desktop/index.html",
                   "apps/desktop/*.json", "apps/desktop/*.ts", "apps/desktop/src-tauri/src/**/*.rs",
                   "apps/desktop/src-tauri/*.json", "apps/desktop/src-tauri/*.toml",
                   "apps/desktop/src-tauri/Cargo.lock", "apps/desktop/src-tauri/build.rs",
                   "apps/desktop/src-tauri/capabilities/**/*.json", "apps/desktop/src-tauri/capabilities/**/*.toml",
                   "apps/desktop/src-tauri/permissions/**/*.toml", "apps/desktop/src-tauri/permissions/**/*.json",
                   "apps/desktop/src-tauri/icons/*",
                   "scripts/build_sidecar.py", "scripts/runtime.spec", "scripts/runtime_entry.py",
                     "scripts/export_contracts.py", "pyproject.toml", "uv.lock", "README.md"]
ACCEPTANCE_SOURCE_PATTERNS = ["scripts/m1/*.py", "scripts/m1/*.ps1", "evals/m1/**/*", "tests/m1/**/*.py",
                              "apps/desktop/src/**/*.test.*", "apps/desktop/src/test/**/*",
                              "apps/desktop/scripts/*.test.*", "scripts/m2/*.py", "tests/m2/**/*.py",
                              "tests/m2/fixtures/release-note/**/*", "tests/m2/fixtures/release-note.zip",
                              "apps/desktop/integration/*.test.tsx", "apps/desktop/e2e/fixture.*",
                               "apps/desktop/e2e/vite.config.ts", "apps/desktop/scripts/verify-*.mjs",
                               "tests/compaction_recovery/*.py",
                              "tests/compaction_recovery/baseline_prepared.json"]


class FileRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    path: str
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def file_record(path: Path, relative_to: Path | None = None) -> dict:
    return {"path": path.relative_to(relative_to).as_posix() if relative_to else str(path.resolve()),
            "size": path.stat().st_size, "sha256": digest(path)}


def source_records(root: Path) -> list[dict]:
    acceptance = {p for pattern in ACCEPTANCE_SOURCE_PATTERNS for p in root.glob(pattern)}
    paths = {p for pattern in SOURCE_PATTERNS for p in root.glob(pattern)
             if p.is_file() and "__pycache__" not in p.parts and p not in acceptance}
    return [file_record(p, root) for p in sorted(paths)]


def acceptance_source_records(root: Path) -> list[dict]:
    """验收记录单独绑定判定器/测试/资料，不让其变更冒充产品输入变更。"""
    paths = {p for pattern in ACCEPTANCE_SOURCE_PATTERNS for p in root.glob(pattern)
             if p.is_file() and "__pycache__" not in p.parts}
    return [file_record(p, root) for p in sorted(paths)]


def _relative(root: Path, name: str) -> Path:
    pure = PurePosixPath(name)
    if (not name or pure.is_absolute() or pure.as_posix() != name
            or any(part in {".", ".."} or ":" in part or "\\" in part for part in pure.parts)):
        raise ValueError("invalid manifest path")
    path = root / name
    if path.resolve().relative_to(root.resolve()).as_posix() != name or path.is_symlink():
        raise ValueError("invalid manifest path")
    return path


def verify_records(root: Path, records: list[dict]) -> set[str]:
    names = set()
    for value in records:
        record = FileRecord.model_validate(value)
        path = _relative(root, record.path)
        if record.path.casefold() in names:
            raise ValueError("duplicate manifest path")
        names.add(record.path.casefold())
        if not path.is_file() or file_record(path, root) != value:
            raise ValueError(f"file identity mismatch: {record.path}")
    return names


def _check_selected(names) -> None:
    for value in names:
        name = value.lower().replace("\\", "/")
        # 按顶层包身份匹配；griffe.docstrings.numpy是文档解析器，不是numpy能力。
        top = re.split(r"[/.-]", name.removeprefix("_internal/"))[0]
        if (top in EXCLUDES
                or any(word in name for word in ("fastembed", "onnx", "pydantic_monty", "lancedb", "pyarrow"))
                or "m0/" in name or name.rsplit("/", 1)[-1] == "credentials.json"
                or name.endswith((".db", ".sqlite3"))
                or name.endswith("config.json")):
            raise ValueError(f"unselected bundle content: {value}")
        if name.startswith("pydantic_ai.providers.") and name.split(".")[2] not in {
            "openai", "openai_compatible", "anthropic", "_openai_compatible", "_bedrock_model_names",
            "_oauth_provider", "gateway",
        }:
            raise ValueError(f"unselected provider: {value}")


def archive_inventory(executable: Path) -> dict:
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(str(executable))
    carchive, pyz = sorted(archive.toc), []
    for name, entry in archive.toc.items():
        if entry[-1] == "z":
            pyz.extend(archive.open_embedded_archive(name).toc)
    _check_selected(carchive + pyz)
    if not REQUIRED_MODULES <= set(pyz):
        raise ValueError("incomplete production PYZ")
    return {"carchive": carchive, "pyz": sorted(pyz)}


def component_inventory(root: Path) -> dict[str, str]:
    components = {}
    for path in sorted(root.glob("_internal/*.dist-info/METADATA")):
        metadata = BytesParser().parsebytes(path.read_bytes())
        name = re.sub(r"[-_.]+", "-", metadata["Name"]).lower()
        if name in components:
            raise ValueError("duplicate component metadata")
        components[name] = metadata["Version"]
    if not REQUIRED_COMPONENTS <= components.keys():
        raise ValueError("missing distribution metadata")
    _check_selected(components)
    return components


def create_manifest(root: Path, *, source_root: Path = ROOT) -> dict:
    files = [file_record(p, root) for p in sorted(root.rglob("*"))
             if p.is_file() and p != root / MANIFEST]
    _check_selected(f["path"] for f in files)
    if missing := REQUIRED_NATIVE_FILES - {item["path"] for item in files}:
        raise ValueError("missing capability native modules: " + ", ".join(sorted(missing)))
    components = component_inventory(root)
    verify_component_lock(components, source_root)
    return {"schema_version": 2, "product": "FlowMate", "identifier": "dev.flowmate.app",
            "selected_extras": list(SELECTED_EXTRAS), "entrypoint": "flowmate-runtime.exe",
            "build": {"python": platform.python_version(), "pyinstaller": importlib.metadata.version("pyinstaller"),
                      "platform": platform.platform()},
            "sources": source_records(source_root), "files": files,
            "components": components,
            "archives": archive_inventory(root / "flowmate-runtime.exe")}


def verify_component_lock(components: dict, source_root: Path) -> None:
    locked = {p["name"]: p["version"] for p in
              tomllib.loads((source_root / "uv.lock").read_text(encoding="utf-8"))["package"]
              if p["name"] != "flowmate"}
    # editable项目使用动态版本，uv.lock不带version；与被绑定源码的字面量身份核对。
    identity = ast.parse((source_root / "packages/flowmate/__init__.py").read_text(encoding="utf-8"))
    locked["flowmate"] = next(ast.literal_eval(node.value) for node in identity.body
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "__version__"
                                               for target in node.targets))
    if any(locked.get(name) != version for name, version in components.items()):
        raise ValueError("distributed component differs from bound uv.lock")


def verify_manifest(root: Path, manifest: dict, *, source_root: Path = ROOT) -> None:
    if (set(manifest) != {"schema_version", "product", "identifier", "selected_extras", "entrypoint",
                          "build", "sources", "files", "components", "archives"}
            or manifest["schema_version"] != 2 or manifest["product"] != "FlowMate"
            or manifest["identifier"] != "dev.flowmate.app" or manifest["selected_extras"] != list(SELECTED_EXTRAS)
            or manifest["entrypoint"] != "flowmate-runtime.exe"
            or manifest["build"]["pyinstaller"] != "6.22.3"):
        raise ValueError("invalid M2 bundle identity")
    names = verify_records(root, manifest["files"])
    actual = {p.relative_to(root).as_posix().casefold() for p in root.rglob("*")
              if p.is_file() and p != root / MANIFEST}
    if names != actual or "flowmate-runtime.exe" not in names:
        raise ValueError("incomplete bundle file set")
    if missing := REQUIRED_NATIVE_FILES - names:
        raise ValueError("missing capability native modules: " + ", ".join(sorted(missing)))
    if missing := REQUIRED_RESOURCES - names:
        raise ValueError("missing product resources: " + ", ".join(sorted(missing)))
    verify_records(source_root, manifest["sources"])
    if manifest["sources"] != source_records(source_root):
        raise ValueError("current source/lock inventory mismatch")
    _check_selected(f["path"] for f in manifest["files"])
    if component_inventory(root) != manifest["components"]:
        raise ValueError("distribution component mismatch")
    verify_component_lock(manifest["components"], source_root)
    if archive_inventory(root / manifest["entrypoint"]) != manifest["archives"]:
        raise ValueError("actual PYZ/CArchive inventory mismatch")


def collection_excludes() -> list[str]:
    """SDK的infer分支含所有供应商；仅保留生产两种协议及自定义compatible provider。"""
    import pydantic_ai

    package = Path(pydantic_ai.__file__).parent
    excludes = EXCLUDES.copy()
    for namespace in ("providers", "models", "embeddings", "images", "realtime"):
        for path in (package / namespace).iterdir():
            name = path.stem if path.is_file() else path.name
            if name.startswith("_") or name == "AGENTS":
                continue
            # gateway的is_gateway_provider被OpenAI/Anthropic适配器无条件导入。
            if namespace == "providers" and name in {"openai", "openai_compatible", "anthropic", "gateway"}:
                continue
            if namespace == "models" and name in {
                "openai", "anthropic", "batch", "concurrency", "decision", "fallback",
                "function", "instrumented", "test", "wrapper",
            }:
                continue
            if namespace in {"embeddings", "images", "realtime"} and name in {
                "base", "result", "settings", "instrumented", "test", "wrapper",
                "codec", "lifecycle", "model", "profiles",
            }:
                continue
            if path.is_dir() or path.suffix == ".py":
                excludes.append(f"pydantic_ai.{namespace}.{name}")
    excludes += ["pydantic_ai.toolsets.monty", "pydantic_ai.capabilities.monty"]
    return excludes


def metadata_files(module_names=()) -> list[tuple[str, str]]:
    from PyInstaller.utils.hooks import copy_metadata

    # recursive 不展开 extra marker；显式绑定 M2 选定依赖，不靠偶然的模块反推。
    names = REQUIRED_COMPONENTS | {"pydantic-graph"}
    if module_names:
        mapping = importlib.metadata.packages_distributions()
        names.update(name for module in module_names for name in mapping.get(module.split(".")[0], []))
    return sorted({entry for name in names for entry in copy_metadata(name, recursive=True)})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / ".local/m2"):
        parser.error("M2 构建输出必须在.local/m2内，保留历史M0/M1")
    if (output / "flowmate-runtime").exists():
        parser.error("目标onedir已存在；请使用新的M2构建目录，不自动覆盖")
    if importlib.metadata.version("pyinstaller") != "6.22.3":
        parser.error("需要锁定的PyInstaller 6.22.3")
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-m", "PyInstaller", "--clean", "--noconfirm",
                    "--distpath", str(output), "--workpath", str(output / "work"),
                    str(ROOT / "scripts/runtime.spec")], cwd=ROOT, check=True,
                   env={**os.environ, "PYTHONHASHSEED": "0"})
    bundle = output / "flowmate-runtime"
    manifest = create_manifest(bundle)
    verify_manifest(bundle, manifest)
    (bundle / MANIFEST).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"bundle": str(bundle), "manifest": file_record(bundle / MANIFEST),
                      "bytes": sum(f["size"] for f in manifest["files"]),
                      "components": manifest["components"], "pyz_modules": len(manifest["archives"]["pyz"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
