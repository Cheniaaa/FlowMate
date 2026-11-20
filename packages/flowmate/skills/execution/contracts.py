"""脚本入口与版本级许可；不接受解释器路径或代码正文。"""

from typing import Literal

from pydantic import Field

from flowmate.contracts.base import Contract, Id, Version, identifier
from flowmate.contracts.execution import ArtifactRef
from flowmate.contracts.scopes import ScopeRef
from flowmate.processes.contracts import ProcessIdentity
from flowmate.skills.contracts import ContentHash, SkillBinding


class RunSkillScript(Contract):
    skill_id: Id
    content_hash: ContentHash
    script_relative_path: str
    environment_id: Id
    environment_revision: Version
    arguments: list[str] = Field(default_factory=list, max_length=200)
    input_refs: list[Id] = Field(default_factory=list, max_length=200)


class SkillExecutionPermission(Contract):
    id: Id = Field(default_factory=identifier)
    skill_id: Id
    content_hash: ContentHash
    environment_id: Id
    environment_revision: Version
    scope: ScopeRef
    revision: Version = 1
    status: Literal["active", "revoked"] = "active"


class ScriptLog(Contract):
    encoding: Literal["utf-8", "base64"]
    content: str


class ScriptArtifact(Contract):
    relative_path: str
    artifact: ArtifactRef


class ScriptExecutionResult(Contract):
    skill_id: Id
    content_hash: ContentHash
    script_relative_path: str
    script_hash: ContentHash
    environment_id: Id
    environment_revision: Version
    executable_identity: str
    attempt_id: Id
    exit_code: int | None
    termination_reason: Literal["exited", "cancelled", "timed_out"]
    stdout: ScriptLog
    stderr: ScriptLog
    truncated: bool
    process_identity: ProcessIdentity | None
    outputs: list[ScriptArtifact]
    collection_error: str | None = None
    external_costs: Literal["unknown"] = "unknown"


class ScriptExecutionSummary(Contract):
    """过程投影只含事实和公开引用，不复制脚本日志、env 或执行路径。"""

    skill_id: Id
    content_hash: ContentHash
    script_relative_path: str
    environment_id: Id
    environment_revision: Version
    attempt_id: Id
    exit_code: int | None
    termination_reason: Literal["exited", "cancelled", "timed_out"]
    truncated: bool
    outputs: list[ScriptArtifact]
    collection_error: str | None = None
    external_costs: Literal["unknown"] = "unknown"


class SkillScriptSettings(Contract):
    skill_id: Id
    content_hash: ContentHash
    scope: ScopeRef
    scripts: list[str]
    binding: SkillBinding | None
    permissions: list[SkillExecutionPermission]


def process_destination(skill_id, content_hash, environment_id, revision):
    return f"skill:{skill_id}:{content_hash}:environment:{environment_id}:{revision}"
