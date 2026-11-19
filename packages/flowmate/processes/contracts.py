"""进程契约；仅可信宿主构造 ProcessSpec，不承担 Skill 或权限解释。"""

from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import AwareDatetime, Field

from flowmate.contracts.base import Contract, Id, Version, identifier

DEFAULT_PROCESS_TIMEOUT_SECONDS = 300
DEFAULT_MAX_PROCESSES = 2
DEFAULT_PROCESS_OUTPUT_LIMIT = 1024 * 1024
EnvironmentKind = Literal["python", "node", "powershell", "bash"]
CwdMode = Literal["attempt", "package_copy"]
EnvironmentStatus = Literal[
    "unprobed", "probed", "missing_executable", "identity_changed",
    "dependency_changed", "probe_failed",
]


class FileEvidence(Contract):
    path: str
    sha256: str | None


class DependencyEvidence(Contract):
    coverage: Literal["unverified", "manifests_only"] = "unverified"
    manifests: list[FileEvidence] = Field(default_factory=list)
    venv_config: FileEvidence | None = None
    base_executable: FileEvidence | None = None


class SaveExecutionEnvironment(Contract):
    id: Id = Field(default_factory=identifier)
    kind: EnvironmentKind
    # 这些路径由用户明确选择，不是资源私有绑定或宿主自动推断出的执行目标。
    executable_path: str
    # 更新时省略/None 保留现有非秘密绑定；显式 {} 清空，UI 无需读取执行值。
    env: dict[str, str] | None = Field(default=None, repr=False)
    cwd_mode: CwdMode = "attempt"
    dependency_manifest_paths: list[str] | None = None


class ExecutionEnvironment(Contract):
    id: Id
    revision: Version
    kind: EnvironmentKind
    executable_path: str
    executable_identity: str | None
    # 固定修订最后一次成功实测的版本；暂时失败不抹去比较身份所需的依据。
    version: str | None
    env: dict[str, str] = Field(default_factory=dict, repr=False)
    cwd_mode: CwdMode
    dependency_manifest_paths: list[str] = Field(default_factory=list)
    dependency_evidence: DependencyEvidence = Field(default_factory=DependencyEvidence)
    status: EnvironmentStatus
    last_probe: "EnvironmentProbe | None" = None


class EnvironmentProbe(Contract):
    environment_id: Id
    revision: Version
    executable_identity: str | None
    dependency_evidence: DependencyEvidence = Field(default_factory=DependencyEvidence)
    observed_executable_identity: str | None = None
    observed_dependency_evidence: DependencyEvidence | None = None
    version: str | None
    observed_version: str | None = None
    started_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))
    checked_at: AwareDatetime
    status: EnvironmentStatus
    diagnostic_code: str | None
    applied: bool = True
    exit_code: int | None = None


class ExecutionEnvironmentView(Contract):
    """公开设置投影；只显示用户选择的路径，不携带执行 env 值或基础环境私有路径。"""

    id: Id
    revision: Version
    kind: EnvironmentKind
    executable_path: str
    executable_identity: str | None
    version: str | None
    cwd_mode: CwdMode
    env_keys: list[str]
    dependency_coverage: Literal["unverified", "manifests_only"]
    manifest_count: int
    status: EnvironmentStatus
    checked_at: AwareDatetime | None
    diagnostic_code: str | None


class ExecutionEnvironmentCommandStatus(Contract):
    status: Literal["confirmed", "not_found"]
    result: ExecutionEnvironmentView | None


class EnvironmentChanged(Contract):
    """全局失效只给读取者一个重新查询的定位，不广播执行配置。"""

    environment_id: Id


class ProcessSpec(Contract):
    invocation_id: Id
    environment: ExecutionEnvironment
    # 不包含 executable；包括宿主选定的固定解释器参数、脚本路径及用户参数。
    argv: list[str]
    cwd: str
    deadline: AwareDatetime = Field(
        default_factory=lambda: datetime.now(UTC) + timedelta(
            seconds=DEFAULT_PROCESS_TIMEOUT_SECONDS,
        ),
    )
    stdout_limit: int = Field(default=DEFAULT_PROCESS_OUTPUT_LIMIT, ge=0)
    stderr_limit: int = Field(default=DEFAULT_PROCESS_OUTPUT_LIMIT, ge=0)


class ProcessIdentity(Contract):
    pid: int
    created_at: AwareDatetime


class ProcessResult(Contract):
    exit_code: int | None
    termination_reason: Literal["exited", "cancelled", "timed_out"]
    stdout: bytes
    stderr: bytes
    truncated: bool
    started_at: AwareDatetime
    finished_at: AwareDatetime
    process_identity: ProcessIdentity | None
