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
            tx.execute("INSERT INTO scopes(id,kind,workspace_id) VALUES (?,'workspace',?)", (value.id,value.id))
            if event.kind == "workspace.default_created":
                tx.execute("INSERT INTO workspace_identity VALUES (1,?)", (value.id,))
        case "workspace.directory_changed":
            tx.execute("UPDATE workspaces SET version=?,directory_resource_id=? WHERE id=?",
                       (value.version, value.directory_resource_id, value.id))
        case "session.created":
            tx.execute(
                "INSERT INTO sessions(id, version, workspace_id, title, agent_profile_id,kind,archived,document) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (value.id, value.version, value.workspace_id, value.title, value.agent_profile_id,
                 value.kind,value.archived,value.model_dump_json()),
            )
            tx.execute("INSERT INTO scopes(id,kind,workspace_id,session_id) VALUES (?,'session',?,?)",
                       (value.id,value.workspace_id,value.id))
        case "session.updated":
            tx.execute("UPDATE sessions SET version=?,archived=?,document=? WHERE id=?",
                       (value.version,value.archived,value.model_dump_json(),value.id))
            if value.archived:
                tx.execute("UPDATE delivery_reservations SET released=1,document=json_set(document,'$.released',json('true')) "
                           "WHERE target_session_id=?", (value.id,))
        case "agent.saved":
            tx.save_profile("agent", value.profile)
            if value.set_default:
                tx.execute("INSERT INTO assistant_identity(singleton, profile_id) VALUES (1, ?)",
                           (value.profile.id,))
        case "model.saved":
            tx.save_profile("model", value)
        case "connection.saved":
            tx.save_connection(value)
        case "memory.changed" | "memory.policy_changed" | "memory.maintenance_changed" | "skill.changed" | "environment.changed" | "mcp.changed":
            # 事实由事务内 MemoryProvider 写入；事件只保留不含正文的失效通知。
            pass
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
    for pending in change.pending_commands:
        tx.execute("INSERT INTO pending_user_commands VALUES (?,?,?,?,?) ON CONFLICT(command_id) DO UPDATE SET "
            "state=excluded.state,document=excluded.document",
            (pending.command_id,pending.session_id,pending.created_seq,pending.state,pending.model_dump_json()))
    for intent in change.follow_up_intents:
        tx.execute("INSERT INTO follow_up_intents VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "document=excluded.document",
            (intent.id,intent.source_result,intent.target_session_id,intent.policy_version,
             intent.model_dump_json()))
    for group in change.budget_groups:
        tx.execute("INSERT INTO budget_groups VALUES (?,?) ON CONFLICT(id) DO UPDATE SET "
                   "document=excluded.document",(group.id,group.model_dump_json()))
    for fence in change.admission_fences:
        id = fence.scope.session_id or fence.scope.workspace_id
        tx.execute("INSERT INTO admission_fences VALUES (?,?,?) ON CONFLICT(scope_id) DO UPDATE SET "
                   "generation=excluded.generation,document=excluded.document",(id,fence.generation,fence.model_dump_json()))
    for run in change.runs:
        tx.execute(
            "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
            "state=excluded.state, document=excluded.document",
            (run.id, run.workspace_id, run.interaction_session_id, run.execution_session_id,
             run.root_task_id, run.budget_id, run.budget_group_id,run.kind,
             run.state, run.model_dump_json()),
        )
    for task in change.tasks:
        tx.execute("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "state=excluded.state, document=excluded.document",
                   (task.id, task.run_id, task.parent_task_id,task.origin_task_id,
                    task.binding.execution_session_id, task.binding.interaction_session_id,
                    task.state, task.model_dump_json()))
    for budget in change.budgets:
        tx.execute("INSERT INTO budgets VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                    "document=excluded.document", (budget.id, budget.run_id, budget.model_dump_json()))
    for allocation in change.budget_allocations:
        tx.execute("INSERT INTO budget_allocations VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET "
                   "document=excluded.document",
                   (allocation.run_id,allocation.group_id,allocation.model_dump_json()))
    for activity in change.activities:
        tx.execute("INSERT INTO activities VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "state=excluded.state, document=excluded.document",
                   (activity.id, activity.run_id, activity.task_id, activity.state,
                    activity.model_dump_json()))
    for checkpoint in change.checkpoints:
        tx.execute("INSERT INTO checkpoints VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET "
                   "document=excluded.document", (checkpoint.task_id, checkpoint.model_dump_json()))
    for index, message in enumerate(change.messages):
        session_id = tx.execute("SELECT execution_session_id FROM tasks WHERE id=?", (event.task_id,)).fetchone()[0]
        tx.execute("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (message.id, event.run_id, event.task_id,session_id, message.model_dump_json(), event.event_id, index))
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
        tx.execute("INSERT INTO task_submissions VALUES (?, ?, ?, ?, ?, ?)",
            (submission.command_id, submission.handle.run_id, submission.origin_run_id, submission.origin_task_id,
             submission.args_hash, submission.model_dump_json()))
    for wait in change.waits:
        tx.execute("INSERT INTO waits VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
            "state=excluded.state, document=excluded.document", (wait.id, wait.run_id, wait.owner_task_id,
            wait.target_task_id, wait.state, wait.continuation_id, wait.model_dump_json()))
    for consumption in change.consumptions:
        tx.execute("INSERT INTO consumptions VALUES (?, ?, ?, ?, ?, ?, ?)", (consumption.id, consumption.run_id,
            consumption.task_id, consumption.execution_session_id, consumption.target_task_id,
            consumption.result_version, consumption.model_dump_json()))
    for join in change.joins:
        fact = JoinFact(**join.model_dump(), event_id=event.event_id)
        tx.execute("INSERT INTO joins VALUES (?, ?, ?, ?, ?, ?, ?)", (fact.id, fact.run_id, fact.root_task_id,
            fact.child_task_id, fact.child_result_version, fact.event_id, fact.model_dump_json()))
    for reservation in change.delivery_reservations:
        tx.execute("INSERT INTO delivery_reservations VALUES (?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET "
                   "released=excluded.released,document=excluded.document",
                   (reservation.task_id,reservation.target_session_id,reservation.released,reservation.model_dump_json()))
    for delivery in change.deliveries:
        values=(delivery.id,int(delivery.source_event_id),delivery.target_session_id,delivery.delivery_state,
                delivery.model_dump_json())
        for table in ("delivery_outbox","session_inbox"):
            tx.execute(f"INSERT INTO {table} VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                       "state=excluded.state,document=excluded.document",values)


def apply_policy_change(tx: "UnitOfWork", change: PolicyChange) -> None:
    for resource in change.resources:
        tx.execute("INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "document=excluded.document", (resource.id, resource.scope.workspace_id,
                    resource.scope.session_id, resource.parent_resource_id,
                    resource.canonical_path, resource.model_dump_json()))
        tx.execute("INSERT INTO scopes(id,epoch,status,kind,workspace_id,session_id) VALUES (?,?,'active','resource',?,?) "
                   "ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch",
                   (resource.id, resource.version,resource.scope.workspace_id,resource.scope.session_id))
    for grant in change.grants:
        tx.execute("INSERT INTO grants VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, document=excluded.document",
                   (grant.id, grant.scope.workspace_id, grant.scope.session_id,
                    grant.status, grant.model_dump_json()))
        tx.execute("INSERT INTO scopes(id,epoch,status,kind,workspace_id,session_id) VALUES (?,?,?,'grant',?,?) ON CONFLICT(id) DO UPDATE SET "
                   "epoch=excluded.epoch, status=excluded.status", (grant.id, grant.epoch, grant.status,
                    grant.scope.workspace_id,grant.scope.session_id))
    for approval in change.approvals:
        tx.execute("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, document=excluded.document",
                   (approval.id, approval.run_id, approval.task_id, approval.activity_id,
                     approval.call_id, approval.status, approval.model_dump_json()))


def apply_lifecycle_change(tx: "UnitOfWork", event: RunEvent) -> None:
    change = event.payload
    for group in change.budget_groups:
        tx.execute("INSERT INTO budget_groups VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                   (group.id, group.model_dump_json()))
    for scope in change.scopes:
        tx.execute("UPDATE scopes SET epoch=?,status=? WHERE id=?", (scope.epoch, scope.status,scope.id))
    for budget in change.accounting_budgets:
        tx.execute("INSERT INTO accounting_budgets VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                   (budget.id, budget.run_id, budget.model_dump_json()))
    for activity in change.accounting_activities:
        tx.execute("INSERT INTO accounting_activities VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
                   (activity.id, activity.run_id, activity.budget_id, activity.model_dump_json()))
    for deletion in change.deletions:
        from flowmate.policy.lifecycle import apply_deletion
        apply_deletion(tx, deletion, event.event_id)
