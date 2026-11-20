"""任务原子接管、真实提交链授权与上下文结果消费。"""

import hashlib
import json
from datetime import timedelta
from uuid import NAMESPACE_URL, uuid5

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    AgentResult,
    AgentWork,
    ArtifactRef,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    Checkpoint,
    ModelMessage,
    OutboxItem,
    ResultConsumption,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    SourceSelection,
    SubmitTask,
    TaskHandle,
    TaskResult,
    TaskSnapshot,
    TaskSubmission,
    TextPart,
    ToolResultPart,
)
from flowmate.contracts.settings import Session
from flowmate.policy.contracts import ToolInvocation
from flowmate.policy.service import PolicyService
from flowmate.runtime.budget import BudgetService
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


def task_ancestors(tx, task_id):
    return {row[0] for row in tx.execute(
        "WITH RECURSIVE chain(id) AS (VALUES(?) UNION "
        "SELECT t.parent_task_id FROM tasks t JOIN chain c ON t.id=c.id WHERE t.parent_task_id IS NOT NULL "
        "UNION SELECT t.origin_task_id FROM tasks t JOIN chain c ON t.id=c.id "
        "JOIN task_submissions s ON s.run_id=t.run_id AND s.origin_task_id=t.origin_task_id "
        "AND json_extract(s.document,'$.handle.task_id')=t.id) "
        "SELECT id FROM chain", (task_id,))}


def _target(tx, ctx, handle):
    run, owner = _owner(tx, ctx)
    target = load(tx, TaskSnapshot, handle.task_id)
    if handle.run_id != target.run_id:
        raise DomainError("task_scope_mismatch", "任务句柄与真实Run不一致")
    if owner.id not in task_ancestors(tx, target.id) and target.id not in task_ancestors(tx, owner.id):
        raise DomainError("task_scope_mismatch", "任务句柄不属于当前授权提交链")
    if target.run_id != run.id:
        check_scopes(tx, load(tx, RunSnapshot, target.run_id).scope_dependencies)
    if handle.lifetime != handle_for(tx, target).lifetime:
        raise DomainError("task_scope_mismatch", "任务句柄生命周期不符")
    return run, owner, target


def result_input(tx, entry_id, session_id):
    from flowmate.contracts.execution import ResultInput, SessionInboxEntry

    row = tx.execute("SELECT document FROM session_inbox WHERE id=?", (entry_id,)).fetchone()
    if row is None:
        raise DomainError("not_found", "结果通知不存在")
    entry = SessionInboxEntry.model_validate_json(row[0])
    if entry.target_session_id != session_id:
        raise DomainError("result_target_mismatch", "结果不属于目标会话")
    task = load(tx, TaskSnapshot, entry.result.task_id)
    if (task.run_id != entry.result.run_id or task.state not in TERMINAL
            or task.result_version != entry.result_version or handle_for(tx, task) != entry.result):
        raise DomainError("result_version_conflict", "结果身份或交付版本不一致")
    source = tx.execute("SELECT document FROM events WHERE event_id=?", (entry.source_event_id,)).fetchone()
    if source is None:
        raise DomainError("result_version_conflict", "结果源事件不存在")
    event = NewEvent.model_validate_json(source[0])
    if event.run_id != task.run_id or not any(
            item.id == task.id and item.result_version == entry.result_version and item.state in TERMINAL
            for item in event.payload.tasks):
        raise DomainError("result_version_conflict", "结果不匹配原交付事件")
    result = delivered_result(tx, task, entry.result, input_only=True)
    check_scopes(tx, [*entry.dependencies, *result.dependencies])
    return ResultInput(inbox_entry_id=entry.id, target_session_id=entry.target_session_id,
        source_event_id=entry.source_event_id, handle=entry.result,
        result_version=entry.result_version, dependencies=result.dependencies)


def selected_result(tx, ctx):
    selected = load(tx, TaskSnapshot, ctx.task_id).binding.input_result
    if selected is None:
        raise DomainError("result_not_selected", "当前任务未选择结果输入")
    current = result_input(tx, selected.inbox_entry_id, ctx.interaction_session_id)
    if current != selected:
        raise DomainError("result_version_conflict", "固定结果输入已改变")
    return delivered_result(tx, load(tx, TaskSnapshot, selected.handle.task_id), selected.handle, input_only=True)


def consume_selected_result(tx, ctx, policy):
    result = selected_result(tx, ctx)
    policy.check_run_sources(tx, ctx, result.dependencies,
        source_run_id=result.handle.run_id, source_task_id=result.handle.task_id)
    decision = policy.check_tx(tx, ctx, result.dependencies, "read")
    if not decision.allowed:
        raise DomainError("grant_required", "所选交付缺少当前读取授权")
    run = load(tx, RunSnapshot, ctx.run_id)
    task = load(tx, TaskSnapshot, ctx.task_id)
    if run.kind == "follow_up":
        sent = policy.check_tx(tx, ctx, result.dependencies, "model_send", task.binding.config.model_profile.endpoint)
        if not sent.allowed:
            raise DomainError("context_authorization_required", "自动总结缺少目标模型发送授权")
    if tx.execute("SELECT 1 FROM consumptions WHERE consumer_task_id=? AND target_task_id=? AND result_version=?",
            (ctx.task_id, result.handle.task_id, result.result_version)).fetchone():
        return
    checkpoint = load(tx, Checkpoint, ctx.task_id)
    consumption = ResultConsumption(run_id=ctx.run_id, task_id=ctx.task_id, execution_session_id=ctx.session_id,
        target_task_id=result.handle.task_id, result_version=result.result_version,
        message_boundary=checkpoint.message_boundary, inbox_entry_id=task.binding.input_result.inbox_entry_id)
    emit(tx, run, task.id, "task.consumed", RuntimeChange(consumptions=[consumption],
        messages=[ModelMessage(role="user", origin="task_result", parts=[TextPart(text=result.model_dump_json())],
            source_dependencies=_merge_dependencies([*result.dependencies, *decision.dependencies]))],
        checkpoints=[bump(checkpoint, message_boundary=checkpoint.message_boundary+1)]))


def delivered_result(tx, task, handle, *, input_only=False):
    """只投影明确交付；调用方负责真实提交链或精确Inbox输入关系及用途授权。"""
    if task.state not in TERMINAL:
        raise DomainError("task_result_unavailable", "任务尚无确定终态结果")
    dependencies = list(load(tx, RunSnapshot, task.run_id).scope_dependencies)
    error = task.reason
    if task.kind == "agent":
        checkpoint = load(tx, Checkpoint, task.id)
        output = checkpoint.output
        delivered = isinstance(output, AgentResult) and (
            task.state == "completed" and output.status in {"completed", "partial"}
            or task.state == "failed" and task.reason == "agent_failed" and output.status == "failed")
        if task.state == "completed" and not delivered:
            raise DomainError("task_result_unavailable", "成员缺少明确提交的交付")
        artifacts = []
        if delivered:
            for id in output.artifact_ids:
                row = tx.execute("SELECT document FROM artifacts WHERE id=?", (id,)).fetchone()
                if row is None:
                    raise DomainError("artifact_not_found", "交付产物不存在")
                artifacts.append(ArtifactRef.model_validate_json(row[0]))
            dependencies.extend(checkpoint.output_dependencies)
            dependencies.extend(item for artifact in artifacts for item in artifact.dependencies)
        result = output.model_dump(mode="json") if delivered else None
    else:
        result, found, explicit_ids = None, False, set()
        for row in tx.execute("SELECT document FROM messages WHERE task_id=? ORDER BY event_id,event_index", (task.id,)):
            message = ModelMessage.model_validate_json(row[0])
            for part in message.parts:
                if isinstance(part, ToolResultPart):
                    dependencies.extend(message.source_dependencies)
                    if task.state != "cancelled":
                        result, error, found = part.result, part.error, True
                        if message.activity_id is not None:
                            activity = load(tx, ActivitySnapshot, message.activity_id)
                            if (activity.intent.operation == "skills.run_script" and activity.receipt is not None
                                    and activity.receipt.result is not None):
                                from flowmate.skills.execution.contracts import (
                                    ScriptExecutionResult,
                                )
                                execution = ScriptExecutionResult.model_validate_json(json.dumps(activity.receipt.result))
                                explicit_ids.update(item.artifact.id for item in execution.outputs)
        if task.state == "completed" and not found:
            raise DomainError("task_result_unavailable", "任务缺少已提交工具结果")
        # 工具结果只有显式引用的产物属于交付，不把内部全部产物暴露给总结。
        ids = explicit_ids | (set(result.get("artifact_ids", [])) if isinstance(result, dict) else set())
        if isinstance(result, dict) and result.get("truncated") is True and "artifact_id" in result:
            ids.add(result["artifact_id"])
        artifacts = [ArtifactRef.model_validate_json(row[0]) for row in tx.execute(
            "SELECT document FROM artifacts WHERE task_id=? ORDER BY id", (task.id,))]
        if input_only:
            artifacts = [ref for ref in artifacts if ref.id in ids]
        dependencies.extend(item for artifact in artifacts for item in artifact.dependencies)
    check_scopes(tx, dependencies)
    return TaskResult(handle=handle, result_version=task.result_version, state=task.state,
        result=result, error=error, artifacts=artifacts, dependencies=_merge_dependencies(dependencies))


def handle_for(tx, task):
    run = load(tx, RunSnapshot, task.run_id)
    return TaskHandle(run_id=run.id, task_id=task.id,
        lifetime="managed" if run.kind == "managed" and task.id == run.root_task_id else "run_bound")


class TaskService:
    def __init__(self, store, catalog, *, clock=None, delivery=None, artifacts=None):
        self.store = store
        self.catalog = catalog
        self.clock = clock or utc_now
        self.policy = PolicyService(store, clock=self.clock)
        self.budgets = BudgetService()
        self.artifacts = artifacts
        from flowmate.runtime.delivery import DeliveryService
        self.delivery = delivery or DeliveryService(store,clock=self.clock)
        self.delivery.tasks = self

    def submit(self, ctx, command, meta):
        with self.store.transaction() as tx:
            return self._submit(tx, ctx, command, meta)

    def _submit(self, tx, ctx, command, meta, *, dependencies=()):
        command = (SubmitTask.model_validate_json(json.dumps(command, allow_nan=False))
            if isinstance(command, dict) else SubmitTask.model_validate(command.model_dump()))
        run, origin = _owner(tx, ctx)
        if origin.kind != "agent":
            raise DomainError("recursive_task_submission", "工具任务不能递归提交任务")
        if command.completion_policy == "follow_up" and not run.allow_follow_up:
            raise DomainError("follow_up_not_authorized", "本次用户输入未授权自动总结")
        if command.lifetime == "managed" and not run.allow_managed:
            raise DomainError("managed_not_authorized", "本次用户输入未授权独立后台接管")
        work = command.work
        is_agent = isinstance(work, AgentWork)
        if is_agent:
            from flowmate.agents.checkpoint import CONTROL_TOOLS, agent_output_validator

            agent_output_validator(work.output_schema)
            member = origin.binding.config.members.get(work.profile_id)
            if member is None:
                raise DomainError("member_unavailable", "成员不在本次Run的固定可委派集合")
            normalized = command
        else:
            if origin.binding.config.catalog.tools.get(work.name) != work.version:
                raise DomainError("tool_unavailable", "工具版本不属于当前Run快照")
            tool = self.catalog.get(work.name, work.version)
            arguments = tool.validate_input(work.arguments)
            normalized = command.model_copy(update={"work": work.model_copy(
                update={"arguments": arguments})})
        encoded = json.dumps({"operation": "task.submit", "parameters": {
            "run_id": run.id, "origin_task_id": origin.id, "command": normalized.model_dump(mode="json")},
            "expected_version": meta.expected_version}, sort_keys=True,
            separators=(",", ":"), allow_nan=False)
        args_hash = hashlib.sha256(encoded.encode()).hexdigest()
        previous = tx.execute("SELECT origin_run_id,origin_task_id,args_hash,document FROM task_submissions "
                              "WHERE command_id=?", (meta.command_id,)).fetchone()
        if previous is not None:
            if (previous[0], previous[1], previous[2]) != (run.id, origin.id, args_hash):
                raise DomainError("command_conflict", "同一命令不能更改参数或归属")
            return TaskSubmission.model_validate_json(previous[3])
        if not is_agent and not tool.spec.background_supported:
            raise DomainError("background_unsupported", "工具未声明后台能力")
        if not is_agent and not tool.spec.model_visible:
            raise DomainError("tool_user_only", "此工具只能由用户操作入口发起")
        check_dispatch(tx, run, origin, self.clock())
        group = load(tx, BudgetGroupSnapshot, run.budget_group_id)
        local_limits = load(tx, BudgetSnapshot, run.budget_id).limits
        depth = origin.binding.delegation_depth + 1
        if depth > min(group.limits.max_delegation_depth, local_limits.max_delegation_depth,
                       command.limits.max_delegation_depth):
            raise DomainError("delegation_depth", "委派链深度已达上限")
        deadline = min(run.deadline_at, group.deadline_at,
                       self.clock() + timedelta(seconds=command.limits.deadline_seconds))
        dependencies = _merge_dependencies(ctx.scope_dependencies, dependencies)
        sources = command.sources
        for id in sources.resource_ids:
            self.policy.check_run_sources(tx, ctx, [ScopeDependency(scope_id=id, epoch=1)])
        parent_sources = origin.binding.sources
        if (any(scope not in parent_sources.memory_scopes or scope not in run.sources.memory_scopes
                for scope in sources.memory_scopes)
                or any(parent_sources.skill_versions.get(id) != version
                       or run.sources.skill_versions.get(id) != version
                       or (is_agent and member.skill_versions.get(id) != version)
                       for id, version in sources.skill_versions.items())):
            raise DomainError("outside_run_scope", "提交来源不属于授权子范围")
        from flowmate.skills.service import SkillService
        for id, version in sources.skill_versions.items():
            # 当前运行固定版本仍可委派；管理停用只阻止新 Run，不改变既有内容。
            SkillService(self.store).reference(ctx, id, version, tx=tx)
        sources = SourceSelection(**{**sources.model_dump(),
            "excluded_source_ids": sorted(set(sources.excluded_source_ids)
                | set(parent_sources.excluded_source_ids) | set(run.sources.excluded_source_ids))})
        input_artifacts = [] if is_agent else origin.binding.input_artifacts
        if is_agent:
            requested = []
            unobserved_inputs = set()
            for id in work.input_refs:
                if tx.execute("SELECT 1 FROM artifacts WHERE id=?", (id,)).fetchone():
                    ref = self.artifacts.reference(ctx, id, tx=tx)
                    decision = self.policy.check_tx(tx, ctx, ref.dependencies, "read", artifact_id=id)
                    if not decision.allowed:
                        raise DomainError(decision.reason or "grant_required", "成员输入产物来源尚未授权")
                    input_artifacts.append(ref)
                    requested.extend(ref.dependencies)
                else:
                    record = self.policy.resource(ctx, id, tx=tx)
                    requested.append(ScopeDependency(scope_id=record.id, epoch=record.version))
                    if record.source_version is None:
                        unobserved_inputs.add(record.id)
            # 仅显式输入进入子上下文；原始文件内容仍须真实工具读取。
            uses = {"read": requested}
        else:
            uses = tool.resolve_dependencies(tx, ctx, arguments) if tool.resolve_dependencies else {}
        if not is_agent and set(uses) != set(tool.spec.required_purposes):
            raise DomainError("tool_policy_invalid", "工具用途与来源解析不一致")
        for purpose, requested_dependencies in uses.items():
            if not is_agent and work.name == "skills.run_script" and purpose == "local_process_send":
                # 接管尚无子脚本 Activity；按固定参数检查来源用途，实际派发仍由 Gateway 绑定。
                decision = self.policy.check_script_submission(tx, ctx, arguments,
                    _merge_dependencies(dependencies, requested_dependencies))
            else:
                decision = self.policy.check_tx(tx, ctx, requested_dependencies, purpose)
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "工具所需资料尚未授权",
                                  related_ids=tuple(decision.missing_grants))
            checked = decision.dependencies
            if is_agent:
                source_ids = {item.scope_id for item in [*dependencies, *requested_dependencies]}
                checked = [item for item in checked if item.scope_id in source_ids or tx.execute(
                    "SELECT 1 FROM grants WHERE id=?", (item.scope_id,)).fetchone()]
                checked = [item for item in checked if item.scope_id not in unobserved_inputs]
            dependencies = _merge_dependencies(dependencies, checked)
        check_scopes(tx, dependencies)
        self.policy.check_run_sources(tx, ctx, dependencies)
        # 实际参数依赖也须在显式子来源内，不能先接管、后扩大。
        self.policy.check_run_sources(tx, ctx, dependencies, selection=sources)
        config = origin.binding.config
        if is_agent:
            active = tx.execute("SELECT count(*) FROM tasks t JOIN runs r ON r.id=t.run_id "
                "WHERE r.budget_group_id=? AND json_extract(t.document,'$.kind')='agent' "
                "AND json_extract(t.document,'$.binding.agent_work') IS NOT NULL "
                "AND t.state NOT IN ('completed','failed','cancelled')", (run.budget_group_id,)).fetchone()[0]
            if active >= min(group.limits.max_parallel_agents, local_limits.max_parallel_agents,
                             command.limits.max_parallel_agents):
                raise DomainError("parallel_agent_limit", "并行成员数已达授权上限")
            controls = CONTROL_TOOLS - {"run.finish", "agent.finish"}
            allowed = set(command.allowed_tools).intersection(member.tools)
            tools = {name: version for name, version in config.catalog.tools.items()
                if name in controls or name in allowed and member.tools[name] == version}
            tools["agent.finish"] = self.catalog.snapshot()["agent.finish"]
            config = config.model_copy(update={"agent_profile": member.agent_profile,
                "model_profile": member.model_profile, "model_pricing": member.model_pricing,
                "pricing_unknown_reason": member.pricing_unknown_reason,
                "catalog": config.catalog.model_copy(update={"tools": tools,
                    "mcp_tools": {name: binding for name, binding in config.catalog.mcp_tools.items()
                        if name in tools}})})
        else:
            allowed = set(command.allowed_tools) | {work.name}
            config = config.model_copy(update={"catalog": config.catalog.model_copy(update={
                "tools": {name: version for name, version in config.catalog.tools.items()
                          if name in allowed and run.config.catalog.tools.get(name) == version}})})
            config = config.model_copy(update={"catalog": config.catalog.model_copy(update={
                "mcp_tools": {name: binding for name, binding in config.catalog.mcp_tools.items()
                    if name in config.catalog.tools}})})
        target_run = run
        private_session = is_agent or command.lifetime == "managed"
        if private_session:
            session = Session(workspace_id=run.workspace_id, title=work.goal if is_agent else "后台工具任务",
                agent_profile_id=config.agent_profile.id, kind="execution")
        if command.lifetime == "managed":
            target_run = RunSnapshot(id=identifier(), workspace_id=run.workspace_id,
                interaction_session_id=run.interaction_session_id, execution_session_id=session.id,
                root_task_id=identifier(), budget_id=identifier(), budget_group_id=run.budget_group_id,
                # Run保存执行范围；正文/grant来源事实留在固定调用中，不能把首次观察的文件epoch
                # 当作永久执行身份，否则工具自己发布新正文版本后会撤销自身完成资格。
                kind="managed", config=config, sources=sources, scope_dependencies=ctx.scope_dependencies,
                deadline_at=deadline, allow_managed=run.allow_managed,
                admission_generations=run.admission_generations)
            self.budgets.allocate(tx, run.id, target_run.id, command.limits)
        if private_session:
            tx.append_event(NewEvent(kind="session.created", workspace_id=run.workspace_id,
                session_id=session.id, payload=session))
        created_seq = tx.execute("SELECT coalesce(max(seq),0)+1 FROM events WHERE run_id=?",
                                 (target_run.id,)).fetchone()[0]
        task = TaskSnapshot(id=target_run.root_task_id if command.lifetime == "managed" else identifier(),
            run_id=target_run.id, parent_task_id=None if command.lifetime == "managed" else origin.id,
            origin_task_id=origin.id, kind="agent" if is_agent else "tool",
            executor_id=config.catalog.agent_executor_id if is_agent else "builtin.tool",
            binding=origin.binding.model_copy(update={"execution_session_id":
                session.id if private_session else origin.binding.execution_session_id,
                 "sources": sources, "config": config, "delegation_depth": depth,
                 "agent_work": work if is_agent else None, "input_artifacts": input_artifacts,
                 "input_result": None}),
            created_seq=created_seq, deadline_at=deadline)
        if is_agent:
            goal = ModelMessage(role="user", parts=[TextPart(text=work.goal)], source_dependencies=dependencies)
            checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1)
        else:
            call = ToolInvocation(call_id=meta.command_id, name=work.name, version=work.version,
                arguments=arguments, dependencies=dependencies)
            checkpoint = Checkpoint(task_id=task.id, tool_call=call.model_dump(mode="json"))
        submission = TaskSubmission(handle=TaskHandle(run_id=target_run.id, task_id=task.id, lifetime=command.lifetime),
            command_id=meta.command_id, origin_run_id=run.id, origin_task_id=origin.id, args_hash=args_hash,
            lifetime=command.lifetime, completion_policy=command.completion_policy)
        managed = command.lifetime == "managed"
        emit(tx, target_run, task.id, "task.submitted", RuntimeChange(tasks=[task],
            runs=[target_run] if managed else [],
            submissions=[submission], budgets=[BudgetSnapshot(id=target_run.budget_id, run_id=target_run.id,
                limits=command.limits, task_count=0)] if managed else [],
            checkpoints=[checkpoint], messages=[goal] if is_agent else [],
            outbox=[OutboxItem(run_id=target_run.id, task_id=task.id, operation="step")]), meta.command_id)
        self.budgets.count(tx, target_run.id, "task_count")
        if (managed or command.completion_policy == "follow_up") and target_run.interaction_session_id is not None:
            self.delivery.reserve_tx(tx,task.id,target_run.interaction_session_id)
        return submission

    def status(self, ctx, handle):
        with self.store.transaction(write=False) as tx:
            return _target(tx, ctx, handle)[2]

    def result(self, ctx, handle, consumer):
        with self.store.transaction() as tx:
            return self._result(tx,ctx,handle,consumer)

    def _result(self,tx,ctx,handle,consumer,*,inbox_entry_id=None):
        result, newly_consumed = self._consume(tx, ctx, handle, consumer,inbox_entry_id=inbox_entry_id)
        if newly_consumed:
            run = load(tx, RunSnapshot, ctx.run_id)
            checkpoint = load(tx, Checkpoint, ctx.task_id)
            message = ModelMessage(role="user", origin="task_result",
                parts=[TextPart(text=result.model_dump_json())],source_dependencies=result.dependencies)
            emit(tx, run, ctx.task_id, "task.consumed", RuntimeChange(messages=[message],
                checkpoints=[bump(checkpoint, message_boundary=checkpoint.message_boundary + 1)]))
        return result

    def _consume(self, tx, ctx, handle, consumer, *, inbox_entry_id=None):
        run, owner = _owner(tx, ctx)
        check_dispatch(tx, run, owner, self.clock())
        result = self._view(tx, ctx, handle)
        checkpoint = load(tx, Checkpoint, ctx.task_id)
        if ((consumer.run_id, consumer.task_id) != (ctx.run_id, ctx.task_id)
                or consumer.message_boundary != checkpoint.message_boundary):
            raise DomainError("consumer_mismatch", "结果消费须绑定当前上下文消息边界")
        previous = tx.execute("SELECT 1 FROM consumptions WHERE consumer_task_id=? AND execution_session_id=? AND target_task_id=? "
                              "AND result_version=?",
                              (consumer.task_id,ctx.session_id, handle.task_id, result.result_version)).fetchone()
        if previous:
            return result, False
        consumption = ResultConsumption(run_id=ctx.run_id, task_id=ctx.task_id,
            execution_session_id=ctx.session_id,
            target_task_id=handle.task_id, result_version=result.result_version,
            message_boundary=consumer.message_boundary)
        consumption=consumption.model_copy(update={"inbox_entry_id":inbox_entry_id})
        emit(tx, run, ctx.task_id, "task.consumed", RuntimeChange(consumptions=[consumption]))
        return result, True

    def view(self, ctx, handle):
        with self.store.transaction(write=False) as tx:
            return self._view(tx, ctx, handle)

    def _view(self, tx, ctx, handle):
        _, _, task = _target(tx, ctx, handle)
        result = delivered_result(tx, task, handle)
        self.policy.check_run_sources(tx, ctx, result.dependencies,
             source_run_id=task.run_id, source_task_id=task.id)
        return result

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
                         run.workspace_id, run.interaction_session_id))
            return result

    def _cancel(self, tx, ctx, handle, meta):
        from flowmate.runtime.waits import resolve_waits

        run, owner, task = _target(tx, ctx, handle)
        target_run = load(tx, RunSnapshot, task.run_id)
        if task.id == run.root_task_id:
            raise DomainError("task_not_child", "当前Run根任务须由RunService取消")
        if owner.id == task.id or owner.id not in task_ancestors(tx, task.id):
            raise DomainError("task_scope_mismatch", "只能取消当前任务提交链中的下游任务")
        if meta.expected_version != task.version:
            raise DomainError("version_conflict", "任务状态已改变，请读取当前版本")
        if task.id == target_run.root_task_id:
            from flowmate.runtime.transitions import stop_run
            stop_run(tx, target_run, "cancelled", "user_cancelled")
            result = load(tx, TaskSnapshot, task.id)
        else:
            result = stop_task(tx, target_run, task, "cancelled", "user_cancelled")
        resolve_waits(tx, self.clock(), target_task_id=task.id)
        return result
