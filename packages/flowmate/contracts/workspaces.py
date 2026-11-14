"""原生目录登记的公共结果，不携带路径或隐式授权。"""

from typing import Literal

from flowmate.contracts.base import Contract, Id, Version
from flowmate.contracts.settings import Workspace
from flowmate.policy.contracts import ResourceRef


class WorkspaceDirectoryResult(Contract):
    workspace: Workspace
    directory: ResourceRef


class WorkspaceDirectoryView(Contract):
    workspace_id: Id
    workspace_version: Version
    resource: ResourceRef | None
    state: Literal["unlinked", "available", "unavailable"]
    reason: str | None
