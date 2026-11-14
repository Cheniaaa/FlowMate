"""同一Run的持久后台接管与结果消费。"""

import hashlib
import json
from datetime import UTC
from uuid import NAMESPACE_URL, uuid5

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    BudgetSnapshot,
    Checkpoint,
    ModelMessage,
    OutboxItem,
    ResultConsumption,
    RunSnapshot,
    RuntimeChange,
    TaskHandle,
    TaskResult,
    TaskSnapshot,
    TaskSubmission,
    TextPart,
    ToolResultPart,
)
from flowmate.policy.contracts import ToolInvocation
from flowmate.policy.service import PolicyService
from flowmate.runtime.transitions import (
    bump,
    check_dispatch,
    check_scopes,
    context_for,
    emit,
    load,
    stop_task,
    utc_now,
)
from flowmate.tools.gateway import _merge_dependencies


def control_command_id(run_id: str, task_id: str, message_id: str, call_id: str) -> str:
    identity = json.dumps([run_id, task_id, message_id, call_id], separators=(",", ":"))
    return str(uuid5(uuid5(NAMESPACE_URL, "flowmate:task-control:v1"), identity))


def _owner(tx, ctx):
    actual = context_for(tx, ctx.task_id)
    if actual != ctx.model_copy(update={"activity_id": None}):
        raise DomainError("owner_mismatch", "执行上下文不属于真实任务")
    if ctx.activity_id is not None:
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        if (activity.run_id, activity.task_id) != (ctx.run_id, ctx.task_id):
            raise DomainError("owner_mismatch", "活动不属于当前任务")
    run = load(tx, RunSnapshot, ctx.run_id)
    owner = load(tx, TaskSnapshot, ctx.task_id)
    check_scopes(tx, run.scope_dependencies)
    return run, owner


def _target(tx, ctx, handle):
    run, owner = _owner(tx, ctx)
    target = load(tx, TaskSnapshot, handle.task_id)
    if handle.run_id != run.id or target.run_id != run.id:
        raise DomainError("task_scope_mismatch", "任务句柄不属于当前Run")
    return run, owner, target


class TaskService:
    def __init__(self, store, catalog, *, clock=None):
        self.store = store
        self.catalog = catalog
        self.clock = clock or utc_now
        self.policy = PolicyService(store, clock=self.clock)

    def submit(self, ctx, command, meta):
        with self.store.transaction() as tx:
            return self._submit(tx, ctx, command, meta)

    def _submit(self, tx, ctx, command, meta, *, dependencies=()):
        run, origin = _owner(tx, ctx)
        if origin.kind != "agent":
            raise DomainError("recursive_task_submission", "工具任务不能递归提交任务")
        dependencies = _merge_dependencies(run.scope_dependencies, dependencies)
        check_scopes(tx, dependencies)
        if run.config.catalog.tools.get(command.name) != command.version:
            raise DomainError("tool_unavailable", "工具版本不属于当前Run快照")
        tool = self.catalog.get(command.name, command.version)
        arguments = tool.validate_input(command.arguments)
        normalized = command.model_copy(update={"arguments": arguments.model_dump(mode="json"),
            "deadline_at": command.deadline_at.astimezone(UTC) if command.deadline_at is not None else None})
        encoded = json.dumps(normalized.model_dump(mode="json"), sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
        args_hash = hashlib.sha256(encoded.encode()).hexdigest()
        previous = tx.execute("SELECT run_id,origin_task_id,args_hash,document FROM task_submissions "
                              "WHERE command_id=?", (meta.command_id,)).fetchone()
        if previous is not None:
            if (previous[0], previous[1], previous[2]) != (run.id, origin.id, args_hash):
                raise DomainError("command_conflict", "同一命令不能更改参数或归属")
            return TaskSubmission.model_validate_json(previous[3])
        if not tool.spec.background_supported:
            raise DomainError("background_unsupported", "工具未声明后台能力")
        if not tool.spec.model_visible:
            raise DomainError("tool_user_only", "此工具只能由用户操作入口发起")
        check_dispatch(tx, run, origin, self.clock())
        deadline = (normalized.deadline_at or run.deadline_at).astimezone(UTC)
        if deadline > run.deadline_at or deadline <= self.clock():
            raise DomainError("deadline_exceeded", "子任务时限必须在当前Run授权时限内")
        uses = tool.resolve_dependencies(tx, ctx, arguments) if tool.resolve_dependencies else {}
        if set(uses) != set(tool.spec.required_purposes):
            raise DomainError("tool_policy_invalid", "工具用途与来源解析不一致")
        for purpose, sources in uses.items():
            decision = self.policy.check_tx(tx, ctx, sources, purpose)
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "工具所需资料尚未授权",
                                  related_ids=tuple(decision.missing_grants))
            dependencies = _merge_dependencies(dependencies, decision.dependencies)
        check_scopes(tx, dependencies)
        self.policy.check_run_sources(tx, ctx, dependencies)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        if budget.task_count >= budget.limits.max_tasks:
            raise DomainError("task_limit", "当前Run已达任务数量上限")
        created_seq = tx.execute("SELECT coalesce(max(seq),0)+1 FROM events WHERE run_id=?",
                                 (run.id,)).fetchone()[0]
        task = TaskSnapshot(id=identifier(), run_id=run.id, parent_task_id=run.root_task_id,
            origin_task_id=origin.id, kind="tool", executor_id="builtin.tool",
            created_seq=created_seq, deadline_at=deadline)
        call = ToolInvocation(call_id=meta.command_id, name=command.name, version=command.version,
            arguments=normalized.arguments, dependencies=dependencies)
        submission = TaskSubmission(handle=TaskHandle(run_id=run.id, task_id=task.id),
            command_id=meta.command_id, origin_task_id=origin.id, args_hash=args_hash)
        emit(tx, run, task.id, "task.submitted", RuntimeChange(tasks=[task],
            submissions=[submission], budgets=[bump(budget, task_count=budget.task_count + 1)],
            checkpoints=[Checkpoint(task_id=task.id, tool_call=call.model_dump(mode="json"))],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
        return submission

    def status(self, ctx, handle):
        with self.store.transaction(write=False) as tx:
            return _target(tx, ctx, handle)[2]

    def result(self, ctx, handle, consumer):
        with self.store.transaction() as tx:
            result, newly_consumed = self._consume(tx, ctx, handle, consumer)
            if newly_consumed:
                run = load(tx, RunSnapshot, ctx.run_id)
                checkpoint = load(tx, Checkpoint, ctx.task_id)
                message = ModelMessage(role="user", origin="task_result",
                    parts=[TextPart(text=result.model_dump_json())],
                    source_dependencies=result.dependencies)
                emit(tx, run, ctx.task_id, "task.consumed", RuntimeChange(messages=[message],
                    checkpoints=[bump(checkpoint, message_boundary=checkpoint.message_boundary + 1)]))
            return result

    def _consume(self, tx, ctx, handle, consumer):
        run, owner = _owner(tx, ctx)
        check_dispatch(tx, run, owner, self.clock())
        result = self._view(tx, ctx, handle)
        checkpoint = load(tx, Checkpoint, ctx.task_id)
        if ((consumer.run_id, consumer.task_id) != (ctx.run_id, ctx.task_id)
                or consumer.message_boundary != checkpoint.message_boundary):
            raise DomainError("consumer_mismatch", "结果消费须绑定当前上下文消息边界")
        previous = tx.execute("SELECT 1 FROM consumptions WHERE task_id=? AND target_task_id=? "
                              "AND result_version=?",
                              (consumer.task_id, handle.task_id, result.result_version)).fetchone()
        if previous:
            return result, False
        consumption = ResultConsumption(run_id=ctx.run_id, task_id=ctx.task_id,
            target_task_id=handle.task_id, result_version=result.result_version,
            message_boundary=consumer.message_boundary)
        emit(tx, run, ctx.task_id, "task.consumed", RuntimeChange(consumptions=[consumption]))
        return result, True

    def view(self, ctx, handle):
        with self.store.transaction(write=False) as tx:
            return self._view(tx, ctx, handle)

    def _view(self, tx, ctx, handle):
        run, _, task = _target(tx, ctx, handle)
        if task.state not in TERMINAL:
            raise DomainError("task_result_unavailable", "任务尚无确定终态结果")
        dependencies = list(run.scope_dependencies)
        result, error, found = None, task.reason, False
        for row in tx.execute("SELECT document FROM messages WHERE task_id=? "
                              "ORDER BY event_id,event_index", (task.id,)):
            message = ModelMessage.model_validate_json(row[0])
            for part in message.parts:
                if isinstance(part, ToolResultPart):
                    dependencies.extend(message.source_dependencies)
                    if task.state != "cancelled":
                        result, error, found = part.result, part.error, True
        if task.state == "completed" and not found:
            raise DomainError("task_result_unavailable", "任务缺少已提交工具结果")
        artifacts = [ArtifactRef.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM artifacts WHERE task_id=? ORDER BY id", (task.id,))]
        dependencies.extend(item for artifact in artifacts for item in artifact.dependencies)
        check_scopes(tx, dependencies)
        dependencies = list({item.scope_id: item for item in dependencies}.values())
        return TaskResult(handle=handle, result_version=task.result_version, state=task.state,
                          result=result, error=error, artifacts=artifacts, dependencies=dependencies)

    def cancel(self, ctx, handle, meta):
        encoded = json.dumps({"operation": "task.cancel", "parameters": {
            "run_id": ctx.run_id, "origin_task_id": ctx.task_id, "task_id": handle.task_id},
            "expected_version": meta.expected_version}, sort_keys=True,
            separators=(",", ":"), allow_nan=False)
        request_hash = hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as tx:
            run, _, _ = _target(tx, ctx, handle)
            previous = tx.previous_command(meta.command_id)
            if previous:
                if previous["request_hash"] != request_hash:
                    raise DomainError("command_conflict", "同一命令不能更改参数")
                return TaskSnapshot.model_validate_json(previous["response"])
            result = self._cancel(tx, ctx, handle, meta)
            tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                       (meta.command_id, request_hash, result.model_dump_json(),
                        run.workspace_id, run.session_id))
            return result

    def _cancel(self, tx, ctx, handle, meta):
        from flowmate.runtime.waits import resolve_waits

        run, _, task = _target(tx, ctx, handle)
        if task.kind != "tool" or task.parent_task_id != run.root_task_id:
            raise DomainError("task_not_child", "task.cancel只接受当前Run的子ToolTask，根任务须由RunService取消")
        if meta.expected_version != task.version:
            raise DomainError("version_conflict", "任务状态已改变，请读取当前版本")
        result = stop_task(tx, run, task, "cancelled", "user_cancelled")
        resolve_waits(tx, self.clock(), run_id=run.id, target_task_id=task.id)
        return result
