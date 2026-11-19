"""Run命令入口；配置快照、根任务、预算与初始outbox同时提交。"""

import hashlib
import json
from datetime import timedelta

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.events import NewEvent
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    AdmissionFence,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    CatalogVersions,
    Checkpoint,
    ConfigSnapshot,
    MessageReceipt,
    ModelMessage,
    OutboxItem,
    PendingUserCommand,
    Question,
    RunLimits,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    SourceSelection,
    StopAllReceipt,
    TaskExecutionBinding,
    TaskSnapshot,
    TextPart,
    ToolResultPart,
    WaitRecord,
)
from flowmate.contracts.scopes import ScopeRef
from flowmate.runtime.leases import acquire_session
from flowmate.runtime.transitions import (
    admission_generations,
    bump,
    check_admission,
    check_scopes,
    context_for,
    emit,
    load,
    pending_outbox,
    stop_run,
    utc_now,
)
from flowmate.settings import SettingsService


class RuntimeCatalog:
    def __init__(self, tools=None, plugins=None, *, agent_executor_id="builtin.agent", tool_catalog=None):
        self.tools = tools or {}
        self.plugins = plugins or {}
        self.agent_executor_id = agent_executor_id
        self.tool_catalog = tool_catalog

    def snapshot(self):
        if self.tool_catalog is not None:
            return self.tool_catalog.execution_snapshot().model_copy(update={
                "plugins": dict(self.plugins), "agent_executor_id": self.agent_executor_id})
        return CatalogVersions(tools=self.tools, plugins=self.plugins,
                               agent_executor_id=self.agent_executor_id)

    def require_available(self, saved: CatalogVersions) -> None:
        current = self.snapshot()
        if (saved.agent_executor_id != self.agent_executor_id
                or any(current.tools.get(name) != version for name, version in saved.tools.items())
                or any(current.mcp_tools.get(name) != binding for name, binding in saved.mcp_tools.items()
                    if name in saved.tools)
                or any(self.plugins.get(name) != version for name, version in saved.plugins.items())):
            raise DomainError("blocked_incompatible", "所需工具或插件版本不可用")


class RunService:
    def __init__(self, store, catalog, *, clock=None):
        self.store = store
        self.catalog = catalog
        self.clock = clock or utc_now

    def _command(self, operation, parameters, meta, model, apply):
        encoded = json.dumps({"operation": operation, "parameters": parameters,
                              "expected_version": meta.expected_version}, sort_keys=True,
                             separators=(",", ":"), allow_nan=False)
        request_hash = hashlib.sha256(encoded.encode()).hexdigest()
        with self.store.transaction() as tx:
            row = tx.previous_command(meta.command_id)
            if row is not None:
                if row["request_hash"] != request_hash:
                    raise DomainError("command_conflict", "同一命令不能更改参数")
                return model.model_validate_json(row["response"])
            result, run = apply(tx)
            workspace_id = (tx.execute("SELECT workspace_id FROM sessions WHERE id=?",
                (run.session_id,)).fetchone()[0] if isinstance(run, PendingUserCommand) else run.workspace_id)
            tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                       (meta.command_id, request_hash, result.model_dump_json(),
                          workspace_id,
                         run.session_id if isinstance(run, PendingUserCommand) else run.interaction_session_id))
            return result

    @staticmethod
    def _check_version(run, meta):
        if meta.expected_version != run.version:
            raise DomainError("version_conflict", "运行状态已改变，请读取当前版本")

    def start(self, command, meta):
        def apply(tx):
            pending = self._receive(tx, command, meta)
            if tx.execute("SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                          (command.session_id,)).fetchone():
                raise DomainError("session_busy", "请先处理已接收的用户输入")
            run = self._start_tx(tx, pending)
            return run, run
        return self._command("run.start", command.model_dump(mode="json"), meta, RunSnapshot, apply)

    def _receive(self, tx, command, meta):
        from flowmate.models.pricing import pricing_reason, resolve_pricing
        from flowmate.policy.contracts import ResourceRecord
        from flowmate.runtime.tasks import result_input

        if meta.expected_version is not None:
            raise DomainError("version_conflict", "新建命令不接受已有版本")
        session = tx.execute("SELECT * FROM sessions WHERE id=?", (command.session_id,)).fetchone()
        if session is None or session["kind"] != "interaction":
            raise DomainError("not_found", "交互会话不存在")
        if session["archived"]:
            raise DomainError("session_archived", "请先明确取消归档，再提交会话任务")
        if command.limits.max_tasks < 1:
            raise DomainError("task_limit", "预算不允许创建根任务")
        dependencies = []
        for id in (session["workspace_id"], session["id"]):
            row = tx.execute("SELECT epoch FROM scopes WHERE id=?", (id,)).fetchone()
            if row is None:
                raise DomainError("scope_revoked", "会话范围不存在")
            dependencies.append(ScopeDependency(scope_id=id, epoch=row[0]))
        check_scopes(tx, dependencies)
        from flowmate.skills.service import SkillService
        SkillService(self.store).resolve(ScopeRef(kind="workspace", workspace_id=session["workspace_id"]),
            command.sources.skill_versions, tx=tx)
        profile = SettingsService.resolve_model(tx, command.model_profile_id)
        pricing = resolve_pricing(profile)
        catalog = self.catalog.snapshot()
        if catalog.mcp_tools:
            from flowmate.integrations.tools import configured_server
            selected = {}
            for name, binding in catalog.mcp_tools.items():
                server = configured_server(tx, binding.server_id)
                if server.enabled and server.scope.workspace_id in {None, session["workspace_id"]}:
                    selected[name] = binding
            catalog = catalog.model_copy(update={"mcp_tools": selected,
                "tools": {name: version for name, version in catalog.tools.items()
                    if name not in catalog.mcp_tools or name in selected}})
        config = ConfigSnapshot(agent_profile=tx.get_profile("agent", command.agent_profile_id),
            model_profile=profile, model_pricing=pricing,
            pricing_unknown_reason=pricing_reason(profile) if pricing is None else None,
            catalog=catalog.model_copy(update={"tools": {
                name: version for name, version in catalog.tools.items() if name != "agent.finish"}}))
        config = config.model_copy(update={
            "members": SettingsService.resolve_members(tx, config.catalog, command.sources.skill_versions),
        })
        if len(command.sources.resource_ids) != len(set(command.sources.resource_ids)) or len(command.sources.resource_ids) > 200:
            raise DomainError("resource_selection_invalid", "资料选择重复或超限")
        for resource_id in command.sources.resource_ids:
            row = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
            resource = ResourceRecord.model_validate_json(row[0]) if row else None
            if (resource is None or resource.scope.workspace_id != session["workspace_id"]
                    or resource.scope.session_id not in {None, session["id"]} or resource.kind == "export"):
                raise DomainError("resource_selection_invalid", "所选资料不属于当前会话")
        memory_scopes = command.sources.memory_scopes
        if len({scope.model_dump_json() for scope in memory_scopes}) != len(memory_scopes):
            raise DomainError("memory_selection_invalid", "记忆范围不能重复")
        from flowmate.policy.service import _scope
        for scope in memory_scopes:
            if scope.kind == "session" or scope.workspace_id not in {None, session["workspace_id"]}:
                raise DomainError("memory_selection_invalid", "记忆范围不属于当前项目或本机用户")
            _scope(tx, scope)
        selected = result_input(tx, command.source_result, command.session_id) if command.source_result else None
        return PendingUserCommand(command_id=meta.command_id, session_id=command.session_id, start=command,
            created_seq=tx.execute("SELECT coalesce(max(sequence),0)+1 FROM pending_user_commands WHERE session_id=?",
                (command.session_id,)).fetchone()[0], config=config, scope_dependencies=dependencies,
            admission_generations=admission_generations(tx, session["workspace_id"], session["id"]),
            deadline_at=self.clock() + timedelta(seconds=command.limits.deadline_seconds), input_result=selected)

    def _start_tx(self, tx, pending, *, kind="user", origin=None):
        command, config = pending.start, pending.config
        workspace_id = tx.execute("SELECT workspace_id FROM sessions WHERE id=?", (pending.session_id,)).fetchone()[0]
        check_scopes(tx, pending.scope_dependencies)
        if tx.execute("SELECT archived FROM sessions WHERE id=?", (pending.session_id,)).fetchone()[0]:
            raise DomainError("session_archived", "归档会话不能应用输入")
        if self.clock() >= pending.deadline_at:
            raise DomainError("deadline_exceeded", "接收时的授权期限已过")
        self.catalog.require_available(config.catalog)
        from flowmate.skills.service import SkillService
        # 排队接收的丛集和 hash 不变；新 Run 应用时只复核实际版本及绑定存续。
        SkillService(self.store).resolve(ScopeRef(kind="workspace", workspace_id=workspace_id),
            command.sources.skill_versions, tx=tx)
        run = RunSnapshot(id=identifier(), workspace_id=workspace_id,
            interaction_session_id=pending.session_id, execution_session_id=pending.session_id,
            root_task_id=identifier(), budget_id=identifier(),
            budget_group_id=origin.budget_group_id if origin else identifier(), kind=kind,
            config=config, scope_dependencies=pending.scope_dependencies, sources=command.sources,
            allow_managed=command.allow_managed, allow_follow_up=command.allow_follow_up,
            admission_generations=pending.admission_generations, deadline_at=pending.deadline_at)
        check_admission(tx, run)
        acquire_session(tx, pending.session_id, run.id)
        task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="agent",
            binding=TaskExecutionBinding(execution_session_id=run.execution_session_id,
                interaction_session_id=run.interaction_session_id, config=config, sources=run.sources,
                delegation_depth=0, input_result=pending.input_result),
            executor_id=config.catalog.agent_executor_id, created_seq=1)
        budget = BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=command.limits,
            task_count=0 if origin else 1)
        groups, allocations = [], []
        if origin:
            from flowmate.runtime.budget import BudgetService
            allocations = [BudgetService().allocate(tx, origin.id, run.id, command.limits)]
        else:
            groups = [BudgetGroupSnapshot(id=run.budget_group_id, limits=command.limits, deadline_at=run.deadline_at)]
            allocations = [BudgetAllocation(run_id=run.id, group_id=run.budget_group_id, limits=command.limits)]
        checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1,
            config_versions=config.catalog.plugins)
        emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task], budgets=[budget],
            checkpoints=[checkpoint], budget_groups=groups, budget_allocations=allocations,
            messages=[ModelMessage(role="user", parts=[TextPart(text=command.text)],
                source_dependencies=run.scope_dependencies)],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), pending.command_id)
        if origin:
            from flowmate.runtime.budget import BudgetService
            BudgetService().count(tx, run.id, "task_count")
        if pending.input_result:
            from flowmate.policy.service import PolicyService
            from flowmate.runtime.tasks import consume_selected_result
            consume_selected_result(tx, context_for(tx, task.id), PolicyService(self.store, clock=self.clock))
        return run

    def start_maintenance_tx(self, tx, origin, config, limits, sources, dependencies, state, meta):
        """明确确认可建独立维护预算；自动/未确认只分配原组，不接管聊天lease。"""
        from flowmate.contracts.execution import TaskHandle, TaskSubmission
        from flowmate.contracts.settings import Session
        from flowmate.runtime.budget import BudgetService
        confirmed = state.input.authorization.budget_confirmation is not None
        group = (BudgetGroupSnapshot(id=identifier(), limits=limits, task_count=0,
            deadline_at=self.clock() + timedelta(seconds=limits.deadline_seconds)) if confirmed
            else load(tx, BudgetGroupSnapshot, origin.budget_group_id))
        session = Session(workspace_id=origin.workspace_id, title="记忆整理",
            agent_profile_id=config.agent_profile.id, kind="execution")
        tx.append_event(NewEvent(kind="session.created", workspace_id=session.workspace_id,
            session_id=session.id, payload=session))
        run = RunSnapshot(id=identifier(), workspace_id=origin.workspace_id,
            interaction_session_id=origin.interaction_session_id, execution_session_id=session.id,
            root_task_id=identifier(), budget_id=identifier(), budget_group_id=group.id,
            kind="maintenance", config=config, sources=sources, scope_dependencies=dependencies,
            admission_generations=(admission_generations(tx, origin.workspace_id, origin.interaction_session_id)
                                   if confirmed else origin.admission_generations),
            deadline_at=min(group.deadline_at, self.clock() + timedelta(seconds=limits.deadline_seconds)))
        check_admission(tx, run)
        allocation = (BudgetAllocation(group_id=group.id, run_id=run.id, limits=limits) if confirmed
            else BudgetService().allocate(tx, origin.id, run.id, limits))
        task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="agent",
            origin_task_id=origin.root_task_id, executor_id=config.catalog.agent_executor_id,
            binding=TaskExecutionBinding(execution_session_id=session.id,
                interaction_session_id=run.interaction_session_id, config=config,
                sources=sources, delegation_depth=0), created_seq=1)
        handle = TaskHandle(run_id=run.id, task_id=task.id, lifetime="managed")
        submission = TaskSubmission(handle=handle, command_id=meta.command_id,
            origin_run_id=origin.id, origin_task_id=origin.root_task_id, lifetime="managed",
            args_hash=hashlib.sha256(state.model_dump_json().encode()).hexdigest())
        checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1,
            context_manifest={"memory_maintenance": state.model_dump(mode="json")})
        emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
            budgets=[BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=limits, task_count=0)],
            budget_groups=[group] if confirmed else [],
            budget_allocations=[allocation], submissions=[submission], checkpoints=[checkpoint],
            messages=[ModelMessage(role="user", parts=[TextPart(
                text="仅从本次固定来源提取待审记忆，调用memory.extract提交完整批次；不要执行其他任务。")],
                source_dependencies=dependencies)],
            outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
        BudgetService().count(tx, run.id, "task_count")
        return handle

    def enqueue_user(self, command, meta):
        from flowmate.contracts.execution import StartRun
        from flowmate.runtime.followups import request_yield

        command = StartRun.model_validate(command.model_dump())
        def apply(tx):
            pending = self._receive(tx, command, meta)
            row = tx.execute("SELECT r.document FROM session_leases l JOIN runs r ON r.id=l.run_id "
                "WHERE l.session_id=?", (command.session_id,)).fetchone()
            if row:
                active = RunSnapshot.model_validate_json(row[0])
                if active.kind != "follow_up":
                    raise DomainError("steering_required", "普通用户运行期间请使用steering")
            workspace_id = tx.execute("SELECT workspace_id FROM sessions WHERE id=?",
                (pending.session_id,)).fetchone()[0]
            tx.append_event(NewEvent(kind="command.queued", workspace_id=workspace_id,
                session_id=pending.session_id, causation_id=meta.command_id,
                payload=RuntimeChange(pending_commands=[pending])))
            if row:
                request_yield(tx, active.id, "yield_to_user")
            return pending, pending
        return self._command("run.enqueue_user", command.model_dump(mode="json"), meta, PendingUserCommand, apply)

    def cancel(self, run_id, meta):
        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            run = stop_run(tx, run, "cancelled", "user_cancelled")
            return run, run
        return self._command("run.cancel", {"run_id": run_id}, meta, RunSnapshot, apply)

    def stop_all(self,scope,meta):
        scope=ScopeRef.model_validate(scope.model_dump())
        if scope.kind == "user_global":
            raise DomainError("invalid_scope","停止全部须明确项目或会话范围")
        fingerprint=hashlib.sha256(json.dumps({"scope":scope.model_dump(mode="json"),
            "expected_version":meta.expected_version,"operation":"stop_all"},sort_keys=True).encode()).hexdigest()
        with self.store.transaction() as tx:
            previous=tx.previous_command(meta.command_id)
            if previous is not None:
                if previous["request_hash"] != fingerprint:
                    raise DomainError("command_conflict","同一命令不能改变停止范围")
                return StopAllReceipt.model_validate_json(previous["response"])
            from flowmate.policy.service import _scope
            _scope(tx,scope)
            if scope.kind == "session" and tx.execute(
                    "SELECT kind FROM sessions WHERE id=?",(scope.session_id,)).fetchone()[0] != "interaction":
                raise DomainError("invalid_scope","停止全部只接受交互会话范围")
            id=scope.session_id or scope.workspace_id
            current=admission_generations(tx,scope.workspace_id,scope.session_id)[id]
            if current != meta.expected_version:
                raise DomainError("version_conflict","准入代次已变化，请刷新")
            fence=AdmissionFence(scope=scope,generation=current+1)
            tx.append_event(NewEvent(kind="admission.stopped",workspace_id=scope.workspace_id,
                session_id=scope.session_id,causation_id=meta.command_id,
                payload=RuntimeChange(admission_fences=[fence])))
            column="interaction_session_id" if scope.kind == "session" else "workspace_id"
            from flowmate.runtime.followups import close_intents
            sessions = [id] if scope.kind == "session" else [row[0] for row in tx.execute(
                "SELECT id FROM sessions WHERE workspace_id=? AND kind='interaction'", (id,))]
            for session_id in sessions:
                close_intents(tx, session_id=session_id, reason="stop_all")
            runs=[RunSnapshot.model_validate_json(row[0]) for row in tx.execute(
                f"SELECT document FROM runs WHERE {column}=? AND state NOT IN ('completed','failed','cancelled')",
                (id,)).fetchall()]
            for run in runs:
                if run.kind != "follow_up":
                    stop_run(tx,run,"cancelled","stop_all")
            result=StopAllReceipt(scope=scope,generation=fence.generation,
                cancelled_run_ids=[run.id for run in runs if run.kind != "follow_up"])
            tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)",
                (meta.command_id,fingerprint,result.model_dump_json(),scope.workspace_id,scope.session_id))
            return result

    def resume(self, run_id, meta):
        from flowmate.policy.contracts import ToolInvocation
        from flowmate.runtime.recovery import CONDITION_WAITING_TASKS_SQL

        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            if run.kind == "follow_up" and run.reason == "yield_to_user":
                from flowmate.contracts.execution import FollowUpIntent
                from flowmate.runtime.followups import FollowUpService
                row = tx.execute("SELECT document FROM follow_up_intents WHERE json_extract(document,'$.run_id')=?",
                    (run.id,)).fetchone()
                intent = FollowUpIntent.model_validate_json(row[0])
                if intent.status != "paused" or tx.execute(
                        "SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
                        (run.interaction_session_id,)).fetchone():
                    raise DomainError("resume_blocked", "意图已关闭或仍有用户输入待处理")
                if tx.execute("SELECT archived FROM sessions WHERE id=?", (run.interaction_session_id,)).fetchone()[0]:
                    raise DomainError("session_archived", "归档会话不能恢复自动总结")
                FollowUpService(self.store, self)._resume(tx, intent, run)
                changed = load(tx, RunSnapshot, run.id)
                return changed, changed
            whole_run = run.state in {"interrupted", "blocked_incompatible"}
            if whole_run:
                selected = [TaskSnapshot.model_validate_json(row[0]) for row in tx.execute(
                    "SELECT document FROM tasks WHERE run_id=? AND state NOT IN ('completed','failed','cancelled')",
                    (run.id,))]
            else:
                selected = [TaskSnapshot.model_validate_json(row[0]) for row in tx.execute(
                    f"SELECT document FROM ({CONDITION_WAITING_TASKS_SQL}) WHERE run_id=?", (run.id,))]
                if not selected:
                    raise DomainError("resume_blocked", "当前没有可恢复的条件等待任务")
            check_scopes(tx, run.scope_dependencies)
            check_admission(tx,run)
            if run.execution_session_id == run.interaction_session_id and tx.execute(
                    "SELECT archived FROM sessions WHERE id=?", (run.interaction_session_id,)).fetchone()[0]:
                raise DomainError("session_archived","归档会话不能恢复自动交互")
            if not whole_run and run.execution_session_id == run.interaction_session_id and tx.execute(
                    "SELECT 1 FROM session_leases WHERE session_id=? AND run_id IS NOT NULL AND run_id<>?",
                    (run.interaction_session_id, run.id)).fetchone():
                raise DomainError("session_busy", "会话已有其他推进中的运行")
            if self.clock() >= run.deadline_at:
                raise DomainError("deadline_exceeded", "原授权执行时限已过")
            if tx.execute("SELECT 1 FROM activities WHERE run_id = ? AND state = 'uncertain'",
                          (run.id,)).fetchone():
                raise DomainError("uncertain_activity", "存在未核实的外部操作，不能重放")
            for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
                activity = ActivitySnapshot.model_validate_json(row[0])
                if activity.receipt is not None and not activity.content_committed:
                    raise DomainError("missing_activity_result", "外部结果仅完成补账，缺少可继续的业务结果")
            for row in tx.execute("SELECT document FROM messages WHERE run_id=?", (run.id,)):
                check_scopes(tx, ModelMessage.model_validate_json(row[0]).source_dependencies)
            tasks, items = [], []
            root_state = "running" if whole_run else run.state
            for task in selected:
                self.catalog.require_available(task.binding.config.catalog)
                for row in tx.execute("SELECT document FROM activities WHERE task_id=? AND "
                        "json_extract(document,'$.receipt.error')='blocked_incompatible'", (task.id,)):
                    rejected = ActivitySnapshot.model_validate_json(row[0])
                    if rejected.intent.operation in task.binding.config.catalog.mcp_tools:
                        raise DomainError("blocked_incompatible", "MCP 已拒绝此 Run 的固定目录，请新建 Run")
                if task.deadline_at is not None and self.clock() >= task.deadline_at:
                    raise DomainError("task_deadline_exceeded", "成员原执行时限已过")
                checkpoint = load(tx, Checkpoint, task.id)
                check_scopes(tx, checkpoint.output_dependencies)
                if checkpoint.tool_call is not None:
                    check_scopes(tx, ToolInvocation.model_validate(checkpoint.tool_call).dependencies)
                state = task.state if task.state.startswith("waiting_") else "running"
                waits = [WaitRecord.model_validate_json(item[0]) for item in tx.execute(
                    "SELECT document FROM waits WHERE owner_task_id=?", (task.id,))]
                current_waits = [wait for wait in waits if wait.id in checkpoint.wait_ids]
                questions = [Question.model_validate_json(item[0]) for item in tx.execute(
                    "SELECT document FROM questions WHERE task_id=? AND status='pending'", (task.id,))]
                if any(question.id in checkpoint.wait_ids for question in questions):
                    state = "waiting_user"
                elif any(wait.state == "pending" for wait in current_waits) or checkpoint.phase == "joining":
                    state = "waiting_children"
                elif current_waits or state == "waiting_user":
                    state = "running"
                tasks.append(bump(task, state=state, reason=None))
                if task.id == run.root_task_id:
                    root_state = state
                items.extend(pending_outbox(tx, task.id))
                if state == "running":
                    # 已准备但未派发的活动保留身份；已提交结果不再次执行。
                    prepared = tx.execute("SELECT id FROM activities WHERE task_id=? AND state='prepared'",
                                          (task.id,)).fetchall()
                    items.extend(OutboxItem(run_id=run.id, task_id=task.id, activity_id=item[0],
                                            operation="activity") for item in prepared)
                    if not prepared:
                        items.append(OutboxItem(run_id=run.id, task_id=task.id, operation="step"))
            root_selected = any(task.id == run.root_task_id for task in selected)
            changed = bump(run, state=root_state, reason=None if root_selected or whole_run else run.reason)
            if whole_run and run.execution_session_id == run.interaction_session_id:
                acquire_session(tx,run.interaction_session_id,run.id)
            emit(tx, changed, run.root_task_id, "run.resumed",
                 RuntimeChange(runs=[changed], tasks=tasks, outbox=items), meta.command_id)
            return changed, changed
        return self._command("run.resume", {"run_id": run_id}, meta, RunSnapshot, apply)

    def steer(self, run_id, text, meta):
        if not isinstance(text, str) or not text.strip():
            raise DomainError("invalid_command", "补充要求不能为空")
        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            if run.state in TERMINAL:
                raise DomainError("run_terminal", "已结束运行不能接收补充要求")
            task = load(tx, TaskSnapshot, run.root_task_id)
            if task.kind != "agent":
                raise DomainError("steering_unsupported", "独立工具运行不接收补充要求，请在完成后发送新消息")
            check_scopes(tx, run.scope_dependencies)
            message = ModelMessage(role="user", parts=[TextPart(text=text)],
                                   source_dependencies=run.scope_dependencies, origin="steering")
            changed = bump(run)
            emit(tx, changed, run.root_task_id, "run.steered",
                 RuntimeChange(runs=[changed], tasks=[bump(task)], messages=[message]), meta.command_id)
            return MessageReceipt(message_id=message.id, run_id=run.id, version=changed.version), changed
        return self._command("run.steer", {"run_id": run_id, "text": text},
                             meta, MessageReceipt, apply)

    def snapshot(self, run_id):
        with self.store.transaction(write=False) as tx:
            return load(tx, RunSnapshot, run_id)

    def export_artifact(self, artifact_id, target_ref, expected_target_hash, meta):
        from flowmate.policy.contracts import ResourceRecord, ToolInvocation
        from flowmate.policy.service import PolicyService

        def apply(tx):
            row = tx.execute("SELECT run_id,document FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
            if row is None:
                raise DomainError("not_found", "产物不存在")
            artifact = ArtifactRef.model_validate_json(row[1])
            if meta.expected_version != artifact.version:
                raise DomainError("version_conflict", "产物版本已改变")
            owner = load(tx, RunSnapshot, row[0])
            if owner.interaction_session_id is not None and tx.execute(
                    "SELECT archived FROM sessions WHERE id=?", (owner.interaction_session_id,)).fetchone()[0]:
                raise DomainError("session_archived","归档会话不能提交新的导出运行")
            row = tx.execute("SELECT document FROM resources WHERE id=?", (target_ref,)).fetchone()
            target = ResourceRecord.model_validate_json(row[0]) if row else None
            if (target is None or target.kind != "export" or target.scope.workspace_id != owner.workspace_id
                    or target.scope.session_id not in {None, owner.interaction_session_id}):
                raise DomainError("export_target_invalid", "导出目标须由当前范围的原生保存选择产生")
            check_scopes(tx, [*owner.scope_dependencies, *artifact.dependencies])
            versions = self.catalog.snapshot()
            if "artifacts.export" not in versions.tools:
                raise DomainError("tool_unavailable", "导出工具未装配")
            run = RunSnapshot(id=identifier(), workspace_id=owner.workspace_id,
                interaction_session_id=owner.interaction_session_id, execution_session_id=owner.interaction_session_id,
                root_task_id=identifier(), budget_id=identifier(),budget_group_id=identifier(),
                scope_dependencies=owner.scope_dependencies,
                sources=SourceSelection(resource_ids=PolicyService.resource_closure(tx, artifact.dependencies,
                    source_run_id=owner.id,source_task_id=artifact.task_id)),
                config=owner.config.model_copy(update={"catalog": versions}),
                deadline_at=self.clock() + timedelta(seconds=RunLimits().deadline_seconds))
            run=run.model_copy(update={"admission_generations":
                admission_generations(tx,run.workspace_id,run.interaction_session_id)})
            limits = RunLimits(max_model_requests=0,max_tasks=1)
            acquire_session(tx,run.interaction_session_id,run.id)
            task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="tool",
                binding=TaskExecutionBinding(execution_session_id=run.execution_session_id,
                    interaction_session_id=run.interaction_session_id,config=run.config,
                    sources=run.sources,delegation_depth=0),executor_id="builtin.tool", created_seq=1)
            call = ToolInvocation(call_id=meta.command_id, name="artifacts.export", version=versions.tools["artifacts.export"],
                arguments={"artifact_id": artifact.id, "artifact_version": artifact.version,
                    "content_hash": artifact.content_hash, "target_ref": target_ref, "expected_target_hash": expected_target_hash})
            emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
                budget_groups=[BudgetGroupSnapshot(id=run.budget_group_id,limits=limits,deadline_at=run.deadline_at)],
                budget_allocations=[BudgetAllocation(run_id=run.id,group_id=run.budget_group_id,limits=limits)],
                budgets=[BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=RunLimits(max_model_requests=0, max_tasks=1))],
                checkpoints=[Checkpoint(task_id=task.id, tool_call=call.model_dump(mode="json"), tool_origin="user")],
                outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
            return run, run
        return self._command("artifact.export", {"artifact_id": artifact_id, "target_ref": target_ref,
            "expected_target_hash": expected_target_hash}, meta, RunSnapshot, apply)

    def answer(self, question_id, answer, meta):
        from jsonschema.exceptions import ValidationError

        from flowmate.agents.checkpoint import answer_validator
        from flowmate.config import MAX_ANSWER_TEXT_BYTES

        def apply(tx):
            question = load(tx, Question, question_id)
            if meta.expected_version != question.version:
                raise DomainError("version_conflict", "问题版本已改变")
            run = load(tx, RunSnapshot, question.run_id)
            task = load(tx, TaskSnapshot, question.task_id)
            checkpoint = load(tx, Checkpoint, task.id)
            if (run.state in {"interrupted", "blocked_incompatible", *TERMINAL}
                    or task.id == run.root_task_id and run.state != "waiting_user"
                    or task.state != "waiting_user" or question.status != "pending"
                    or question.id not in checkpoint.wait_ids or question.call_id not in checkpoint.pending_call_ids):
                raise DomainError("question_inactive", "问题当前不接受回答")
            check_scopes(tx, [*run.scope_dependencies, *question.dependencies])
            if self.clock() >= run.deadline_at:
                raise DomainError("deadline_exceeded", "问题所属运行已过期")
            values, text_bytes = [answer], 0
            while values:
                value = values.pop()
                if isinstance(value, str):
                    text_bytes += len(value.encode("utf-8"))
                elif isinstance(value, dict):
                    values.extend(value.values())
                elif isinstance(value, list):
                    values.extend(value)
                if text_bytes > MAX_ANSWER_TEXT_BYTES:
                    raise DomainError("answer_too_large", "回答文本总量不能超过8KiB")
            try:
                answer_validator(question.answer_schema).validate(answer)
            except ValidationError:
                raise DomainError("answer_invalid", "回答不符合问题Schema") from None
            message = ModelMessage(role="tool", origin="answer", parts=[ToolResultPart(
                call_id=question.call_id, origin_message_id=question.message_id, result=answer)], source_dependencies=question.dependencies)
            pending = [id for id in checkpoint.pending_call_ids if id != question.call_id]
            changed = bump(run, state="running", reason=None) if task.id == run.root_task_id else run
            emit(tx, changed, task.id, "question.answered", RuntimeChange(
                runs=[changed] if task.id == run.root_task_id else [],
                tasks=[bump(task, state="running", reason=None)], messages=[message],
                questions=[bump(question, status="answered", answer_message_id=message.id)],
                checkpoints=[bump(checkpoint, pending_call_ids=pending,
                    wait_ids=[id for id in checkpoint.wait_ids if id != question.id],
                    phase="dispatch_tools" if pending else "ready_model",
                    message_boundary=checkpoint.message_boundary + 1)],
                outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
            return changed, changed
        return self._command("run.answer", {"question_id": question_id, "answer": answer}, meta, RunSnapshot, apply)
