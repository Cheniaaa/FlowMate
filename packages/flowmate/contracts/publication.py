"""仅本机受信UI可见的导出恢复事实；路径不进入模型消息。"""

from typing import Literal

from pydantic import AwareDatetime

from flowmate.contracts.base import Contract, Id, Version

PublicationStatus = Literal[
    "staged", "published", "needs_restore", "conflict", "restored", "released", "finalized",
]


class PublicationView(Contract):
    id: Id
    version: Version
    state: PublicationStatus
    workspace_id: Id
    session_id: Id
    run_id: Id
    task_id: Id
    activity_id: Id
    attempt_id: Id
    target_path: str
    stage_path: str
    backup_path: str | None
    target_matches: Literal["original", "published", "missing", "other", "unknown"] = "unknown"
    stage_matches: bool | None = None
    backup_matches: bool | None = None
    last_checked: AwareDatetime | None = None
    maintenance_reason: str | None = None
