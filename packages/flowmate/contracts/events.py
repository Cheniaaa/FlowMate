"""持久配置事件。"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from flowmate.contracts.base import Contract, Count, Id, Units
from flowmate.contracts.execution import RuntimeChange
from flowmate.contracts.settings import (
    AgentProfile,
    ModelConnection,
    ModelProfile,
    Session,
    Workspace,
)
from flowmate.policy.contracts import LifecycleChange, PolicyChange


class AgentSaved(Contract):
    profile: AgentProfile
    set_default: bool = False


class NewEvent(Contract):
    kind: Literal[
        "workspace.created", "workspace.default_created", "workspace.directory_changed", "session.created", "agent.saved", "model.saved", "connection.saved",
        "run.started", "run.cancelled", "run.resumed", "run.steered", "task.stepped",
        "activity.prepared", "activity.dispatched", "activity.received",
        "budget.reserved", "budget.settled", "runtime.recovered",
        "resource.registered", "resource.updated", "grant.created", "grant.revoked",
        "approval.proposed", "approval.decided", "artifact.published",
        "question.asked", "question.answered",
        "task.submitted", "task.cancelled", "task.consumed", "task.joined", "wait.registered", "wait.resolved",
        "scope.deleted", "scope.revoked", "accounting.settled",
    ]
    payload: Workspace | Session | AgentSaved | ModelProfile | ModelConnection | RuntimeChange | PolicyChange | LifecycleChange
    event_version: Literal[1] = 1
    workspace_id: Id | None = None
    session_id: Id | None = None
    run_id: Id | None = None
    task_id: Id | None = None
    activity_id: Id | None = None
    causation_id: Id | None = None
    created_at: AwareDatetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def check_payload(self):
        expected = {
            "workspace.created": Workspace, "workspace.default_created": Workspace,
            "workspace.directory_changed": Workspace, "session.created": Session,
            "agent.saved": AgentSaved, "model.saved": ModelProfile, "connection.saved": ModelConnection,
        }.get(self.kind, LifecycleChange if self.kind.split(".")[0] in {"scope", "accounting"} else
              PolicyChange if self.kind.split(".")[0] in {
            "resource", "grant", "approval",
        } else RuntimeChange)
        if not isinstance(self.payload, expected):
            raise ValueError("事件类型与载荷不匹配")
        if isinstance(self.payload, Workspace) and self.workspace_id != self.payload.id:
            raise ValueError("工作区事件归属不匹配")
        if isinstance(self.payload, Session) and (
            self.workspace_id != self.payload.workspace_id or self.session_id != self.payload.id
        ):
            raise ValueError("会话事件归属不匹配")
        return self


class RunEvent(NewEvent):
    event_id: Units
    seq: Count | None
