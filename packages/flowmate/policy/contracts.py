"""授权事实和审批绑定；路径只存在于可信选择记录。"""

import hashlib
import json
from typing import Literal

from pydantic import AwareDatetime, Field, JsonValue

from flowmate.contracts.base import Contract, Count, Id, Name, Version, identifier
from flowmate.contracts.execution import AccountingActivity, AccountingBudget, ScopeDependency

Purpose = Literal["read", "model_send", "export"]


class ScopeRef(Contract):
    workspace_id: Id
    session_id: Id | None = None


class ExportTargetInfo(Contract):
    parent_path: str
    parent_identity: str
    name: str
    target_identity: str | None = None
    content_hash: str | None = None


class NativeSelection(Contract):
    id: Id = Field(default_factory=identifier)
    scope: ScopeRef
    kind: Literal["file", "directory", "export"]
    canonical_path: str
    file_identity: str = Field(min_length=1)
    export_target: ExportTargetInfo | None = None


class ResourceRef(Contract):
    id: Id
    scope: ScopeRef
    label: str
    version: Version = 1
    kind: Literal["file", "directory", "export"]
    source_version: str | None = None


class ResourceRecord(ResourceRef):
    canonical_path: str
    file_identity: str
    parent_resource_id: Id | None = None
    export_target: ExportTargetInfo | None = None


class GrantCommand(Contract):
    scope: ScopeRef
    resource_ids: list[Id] = Field(min_length=1)
    purposes: list[Purpose] = Field(min_length=1)
    destination: str | None = None


class DataUseGrant(GrantCommand):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    epoch: Version = 1
    status: Literal["active", "revoked"] = "active"


class PolicyDecision(Contract):
    allowed: bool
    reason: str | None = None
    missing_grants: list[Id] = Field(default_factory=list)
    dependencies: list[ScopeDependency] = Field(default_factory=list)


class ToolInvocation(Contract):
    call_id: Name
    name: Name
    version: Name
    arguments: dict[str, JsonValue] = Field(default_factory=dict)
    dependencies: list[ScopeDependency] = Field(default_factory=list)
    target: str | None = None


def invocation_hash(call: ToolInvocation) -> str:
    value = call.model_dump(mode="json")
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


class ExportApprovalPreview(Contract):
    """仅供本地审批展示的固定选择事实；不进入工具参数或模型消息。"""

    target_path: str
    target_exists: bool
    artifact_id: Id
    artifact_version: Version


class Approval(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    workspace_id: Id
    session_id: Id
    run_id: Id
    task_id: Id
    activity_id: Id
    call_id: Name
    tool_name: Name
    tool_version: Name
    args_hash: str
    target: str | None
    export_preview: ExportApprovalPreview | None = None
    parameters: dict[str, JsonValue]
    dependencies: list[ScopeDependency]
    expires_at: AwareDatetime
    status: Literal["pending", "approved", "denied", "superseded", "expired"] = "pending"


class ApprovalNeeded(Contract):
    approval: Approval


class PreparedCall(Contract):
    invocation: ToolInvocation
    source_dependencies: list[ScopeDependency]
    approval_id: Id | None = None
    grant_epochs: list[ScopeDependency] = Field(default_factory=list)


class PolicyChange(Contract):
    resources: list[ResourceRecord] = Field(default_factory=list)
    grants: list[DataUseGrant] = Field(default_factory=list)
    approvals: list[Approval] = Field(default_factory=list)


class ScopeState(Contract):
    id: Id
    scope: ScopeRef
    epoch: Version
    status: Literal["active", "revoked", "deleted"]


class DeletionReceipt(Contract):
    scope: ScopeRef
    epoch: Version
    status: Literal["deleted"] = "deleted"


class CleanupSummary(Contract):
    deleted_blobs: Count
    pending_count: Count


class LifecycleChange(Contract):
    scopes: list[ScopeState] = Field(default_factory=list)
    deletions: list[DeletionReceipt] = Field(default_factory=list)
    accounting_activities: list[AccountingActivity] = Field(default_factory=list)
    accounting_budgets: list[AccountingBudget] = Field(default_factory=list)
