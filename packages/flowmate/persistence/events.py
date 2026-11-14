"""版本化配置reducer；由Store在事件写入的同一事务中调用。"""

from typing import TYPE_CHECKING

from flowmate.contracts.events import RunEvent
from flowmate.contracts.execution import JoinFact
from flowmate.policy.contracts import LifecycleChange, PolicyChange

if TYPE_CHECKING:
    from flowmate.persistence.store import UnitOfWork


def apply_event(tx: "UnitOfWork", event: RunEvent) -> None:
    value = event.payload
    match event.kind:
        case "workspace.created" | "workspace.default_created":
            tx.execute("INSERT INTO workspaces(id, version, name, directory_resource_id) VALUES (?, ?, ?, ?)",
                       (value.id, value.version, value.name, value.directory_resource_id))
            tx.execute("INSERT INTO scopes(id) VALUES (?)", (value.id,))
            if event.kind == "workspace.default_created":
                tx.execute("INSERT INTO workspace_identity VALUES (1,?)", (value.id,))
        case "workspace.directory_changed":
            tx.execute("UPDATE workspaces SET version=?,directory_resource_id=? WHERE id=?",
                       (value.version, value.directory_resource_id, value.id))
        case "session.created":
            tx.execute(
                "INSERT INTO sessions(id, version, workspace_id, title, agent_profile_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (value.id, value.version, value.workspace_id, value.title, value.agent_profile_id),
            )
            tx.execute("INSERT INTO scopes(id) VALUES (?)", (value.id,))
        case "agent.saved":
            tx.save_profile("agent", value.profile)
            if value.set_default:
                tx.execute("INSERT INTO assistant_identity(singleton, profile_id) VALUES (1, ?)",
                           (value.profile.id,))
        case "model.saved":
            tx.save_profile("model", value)
        case "connection.saved":
            tx.save_connection(value)
        case _:
            if isinstance(value, LifecycleChange):
                apply_lifecycle_change(tx, event)
            elif isinstance(value, PolicyChange):
                apply_policy_change(tx, value)
            else:
                apply_runtime_change(tx, event)


def apply_runtime_change(tx: "UnitOfWork", event: RunEvent) -> None:
    """事件只携带本次变动的实体，索引列来自同一DTO。"""
    change = event.payload
    for run in change.runs:
        tx.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
            "state=excluded.state, document=excluded.document",
            (run.id, run.workspace_id, run.session_id, run.root_task_id, run.budget_id,
             run.state, run.model_dump_json()),
        )
    for task in change.tasks:
        tx.execute("INSERT INTO tasks VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "state=excluded.state, document=excluded.document",
                   (task.id, task.run_id, task.parent_task_id, task.state, task.model_dump_json()))
    for budget in change.budgets:
        tx.execute("INSERT INTO budgets VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "document=excluded.document", (budget.id, budget.run_id, budget.model_dump_json()))
    for activity in change.activities:
        tx.execute("INSERT INTO activities VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "state=excluded.state, document=excluded.document",
                   (activity.id, activity.run_id, activity.task_id, activity.state,
                    activity.model_dump_json()))
    for checkpoint in change.checkpoints:
        tx.execute("INSERT INTO checkpoints VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET "
                   "document=excluded.document", (checkpoint.task_id, checkpoint.model_dump_json()))
    for index, message in enumerate(change.messages):
        tx.execute("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)",
                   (message.id, event.run_id, event.task_id, message.model_dump_json(), event.event_id, index))
    for item in change.outbox:
        tx.execute("INSERT INTO outbox VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "state=excluded.state, document=excluded.document",
                   (item.id, item.run_id, item.task_id, item.activity_id, item.operation,
                    item.state, item.model_dump_json()))
    for artifact in change.artifacts:
        tx.execute("INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)",
                   (artifact.id, event.run_id, artifact.task_id, artifact.activity_id,
                     artifact.content_hash, artifact.model_dump_json()))
    for question in change.questions:
        tx.execute("INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, document=excluded.document",
                   (question.id, question.run_id, question.task_id, question.message_id,
                     question.call_id, question.status, question.model_dump_json()))
    for submission in change.submissions:
        tx.execute("INSERT INTO task_submissions VALUES (?, ?, ?, ?, ?)",
            (submission.command_id, submission.handle.run_id, submission.origin_task_id,
             submission.args_hash, submission.model_dump_json()))
    for wait in change.waits:
        tx.execute("INSERT INTO waits VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
            "state=excluded.state, document=excluded.document", (wait.id, wait.run_id, wait.owner_task_id,
            wait.target_task_id, wait.state, wait.continuation_id, wait.model_dump_json()))
    for consumption in change.consumptions:
        tx.execute("INSERT INTO consumptions VALUES (?, ?, ?, ?, ?, ?)", (consumption.id, consumption.run_id,
            consumption.task_id, consumption.target_task_id, consumption.result_version, consumption.model_dump_json()))
    for join in change.joins:
        fact = JoinFact(**join.model_dump(), event_id=event.event_id)
        tx.execute("INSERT INTO joins VALUES (?, ?, ?, ?, ?, ?, ?)", (fact.id, fact.run_id, fact.root_task_id,
            fact.child_task_id, fact.child_result_version, fact.event_id, fact.model_dump_json()))


def apply_policy_change(tx: "UnitOfWork", change: PolicyChange) -> None:
    for resource in change.resources:
        tx.execute("INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "document=excluded.document", (resource.id, resource.scope.workspace_id,
                    resource.scope.session_id, resource.parent_resource_id,
                    resource.canonical_path, resource.model_dump_json()))
        tx.execute("INSERT INTO scopes(id,epoch,status) VALUES (?,?,'active') "
                   "ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch",
                   (resource.id, resource.version))
    for grant in change.grants:
        tx.execute("INSERT INTO grants VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, document=excluded.document",
                   (grant.id, grant.scope.workspace_id, grant.scope.session_id,
                    grant.status, grant.model_dump_json()))
        tx.execute("INSERT INTO scopes(id,epoch,status) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET "
                   "epoch=excluded.epoch, status=excluded.status", (grant.id, grant.epoch, grant.status))
    for approval in change.approvals:
        tx.execute("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, document=excluded.document",
                   (approval.id, approval.run_id, approval.task_id, approval.activity_id,
                     approval.call_id, approval.status, approval.model_dump_json()))


def apply_lifecycle_change(tx: "UnitOfWork", event: RunEvent) -> None:
    change = event.payload
    for scope in change.scopes:
        tx.execute("INSERT INTO scopes(id,epoch,status) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET "
                   "epoch=excluded.epoch,status=excluded.status", (scope.id, scope.epoch, scope.status))
    for budget in change.accounting_budgets:
        tx.execute("INSERT INTO accounting_budgets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                   (budget.id, budget.run_id, budget.model_dump_json()))
    for activity in change.accounting_activities:
        tx.execute("INSERT INTO accounting_activities VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                   (activity.id, activity.run_id, activity.budget_id, activity.model_dump_json()))
    for deletion in change.deletions:
        from flowmate.policy.lifecycle import apply_deletion
        apply_deletion(tx, deletion, event.event_id)
