"""Run命令入口；配置快照、根任务、预算与初始outbox同时提交。"""

import hashlib
import json
from datetime import timedelta

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    BudgetSnapshot,
    CatalogVersions,
    Checkpoint,
    ConfigSnapshot,
    MessageReceipt,
    ModelMessage,
    OutboxItem,
    Question,
    RunLimits,
    RunSnapshot,
    RuntimeChange,
    ScopeDependency,
    TaskSnapshot,
    TextPart,
    ToolResultPart,
    WaitRecord,
)
from flowmate.runtime.transitions import (
    bump,
    check_scopes,
    emit,
    load,
    pending_outbox,
    stop_run,
    utc_now,
)
from flowmate.settings import SettingsService


class RuntimeCatalog:
    def __init__(self, tools=None, plugins=None, *, agent_executor_id="builtin.agent"):
        self.tools = tools or {}
        self.plugins = plugins or {}
        self.agent_executor_id = agent_executor_id

    def snapshot(self):
        return CatalogVersions(tools=self.tools, plugins=self.plugins,
                               agent_executor_id=self.agent_executor_id)

    def require_available(self, saved: CatalogVersions) -> None:
        if (saved.agent_executor_id != self.agent_executor_id
                or any(self.tools.get(name) != version for name, version in saved.tools.items())
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
            tx.execute("INSERT INTO commands VALUES (?, ?, ?, ?, ?)",
                       (meta.command_id, request_hash, result.model_dump_json(),
                        run.workspace_id, run.session_id))
            return result

    @staticmethod
    def _check_version(run, meta):
        if meta.expected_version != run.version:
            raise DomainError("version_conflict", "运行状态已改变，请读取当前版本")

    def start(self, command, meta):
        def apply(tx):
            if meta.expected_version is not None:
                raise DomainError("version_conflict", "新建运行不接受已有版本")
            session = tx.execute("SELECT * FROM sessions WHERE id = ?",
                                 (command.session_id,)).fetchone()
            if session is None:
                raise DomainError("not_found", "会话不存在")
            active = tx.execute("SELECT id FROM runs WHERE session_id = ? AND "
                                "state NOT IN ('completed','failed','cancelled')",
                                (command.session_id,)).fetchone()
            if active:
                raise DomainError("session_busy", "会话已有未完成运行", related_ids=(active[0],))
            if command.limits.max_tasks < 1:
                raise DomainError("task_limit", "预算不允许创建根任务")
            dependencies = []
            for id in (session["workspace_id"], session["id"]):
                row = tx.execute("SELECT epoch FROM scopes WHERE id = ?", (id,)).fetchone()
                if row is None:
                    raise DomainError("scope_revoked", "会话范围不存在")
                dependencies.append(ScopeDependency(scope_id=id, epoch=row[0]))
            check_scopes(tx, dependencies)
            from flowmate.models.pricing import pricing_reason, resolve_pricing

            profile = SettingsService.resolve_model(tx, command.model_profile_id)
            pricing = resolve_pricing(profile)
            config = ConfigSnapshot(
                agent_profile=tx.get_profile("agent", command.agent_profile_id),
                model_profile=profile, model_pricing=pricing,
                pricing_unknown_reason=pricing_reason(profile) if pricing is None else None,
                catalog=self.catalog.snapshot(),
            )
            from flowmate.policy.contracts import ResourceRecord
            if len(command.resource_ids) != len(set(command.resource_ids)) or len(command.resource_ids) > 200:
                raise DomainError("resource_selection_invalid", "资料选择重复或超限")
            for resource_id in command.resource_ids:
                row = tx.execute("SELECT document FROM resources WHERE id=?", (resource_id,)).fetchone()
                resource = ResourceRecord.model_validate_json(row[0]) if row else None
                if (resource is None or resource.scope.workspace_id != session["workspace_id"]
                        or resource.scope.session_id not in {None, session["id"]} or resource.kind == "export"):
                    raise DomainError("resource_selection_invalid", "所选资料不属于当前会话")
            run = RunSnapshot(id=identifier(), workspace_id=session["workspace_id"],
                session_id=session["id"], root_task_id=identifier(), budget_id=identifier(),
                config=config, scope_dependencies=dependencies, resource_ids=command.resource_ids,
                deadline_at=self.clock() + timedelta(seconds=command.limits.deadline_seconds))
            task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="agent",
                                executor_id=config.catalog.agent_executor_id, created_seq=1)
            budget = BudgetSnapshot(id=run.budget_id, run_id=run.id, limits=command.limits)
            checkpoint = Checkpoint(task_id=task.id, phase="ready_model", message_boundary=1,
                                    config_versions=config.catalog.plugins)
            message = ModelMessage(role="user", parts=[TextPart(text=command.text)],
                                   source_dependencies=dependencies)
            emit(tx, run, task.id, "run.started", RuntimeChange(
                runs=[run], tasks=[task], budgets=[budget], checkpoints=[checkpoint],
                messages=[message], outbox=[OutboxItem(run_id=run.id, task_id=task.id,
                                                      operation="step")],
            ), meta.command_id)
            return run, run
        return self._command("run.start", command.model_dump(mode="json"), meta, RunSnapshot, apply)

    def cancel(self, run_id, meta):
        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            run = stop_run(tx, run, "cancelled", "user_cancelled")
            return run, run
        return self._command("run.cancel", {"run_id": run_id}, meta, RunSnapshot, apply)

    def resume(self, run_id, meta):
        from flowmate.policy.contracts import ToolInvocation

        def apply(tx):
            run = load(tx, RunSnapshot, run_id)
            self._check_version(run, meta)
            if run.state not in {"interrupted", "blocked_incompatible", "waiting_user"}:
                raise DomainError("resume_blocked", "只有中断或等待条件的运行可以恢复")
            check_scopes(tx, run.scope_dependencies)
            if self.clock() >= run.deadline_at:
                raise DomainError("deadline_exceeded", "原授权执行时限已过")
            if tx.execute("SELECT 1 FROM activities WHERE run_id = ? AND state = 'uncertain'",
                          (run.id,)).fetchone():
                raise DomainError("uncertain_activity", "存在未核实的外部操作，不能重放")
            for row in tx.execute("SELECT document FROM activities WHERE run_id=?", (run.id,)):
                activity = ActivitySnapshot.model_validate_json(row[0])
                if activity.receipt is not None and not activity.content_committed:
                    raise DomainError("missing_activity_result", "外部结果仅完成补账，缺少可继续的业务结果")
            self.catalog.require_available(run.config.catalog)
            for row in tx.execute("SELECT document FROM messages WHERE run_id=?", (run.id,)):
                check_scopes(tx, ModelMessage.model_validate_json(row[0]).source_dependencies)
            tasks, items = [], []
            root_state = "running"
            for row in tx.execute("SELECT document FROM tasks WHERE run_id=? AND state NOT IN "
                    "('completed','failed','cancelled')", (run.id,)).fetchall():
                task = TaskSnapshot.model_validate_json(row[0])
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
            changed = bump(run, state=root_state, reason=None)
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
            if tx.execute("SELECT 1 FROM runs WHERE session_id=? AND state NOT IN ('completed','failed','cancelled')",
                          (owner.session_id,)).fetchone():
                raise DomainError("session_busy", "请等待当前会话任务结束后导出")
            row = tx.execute("SELECT document FROM resources WHERE id=?", (target_ref,)).fetchone()
            target = ResourceRecord.model_validate_json(row[0]) if row else None
            if (target is None or target.kind != "export" or target.scope.workspace_id != owner.workspace_id
                    or target.scope.session_id not in {None, owner.session_id}):
                raise DomainError("export_target_invalid", "导出目标须由当前范围的原生保存选择产生")
            check_scopes(tx, [*owner.scope_dependencies, *artifact.dependencies])
            versions = self.catalog.snapshot()
            if "artifacts.export" not in versions.tools:
                raise DomainError("tool_unavailable", "导出工具未装配")
            run = RunSnapshot(id=identifier(), workspace_id=owner.workspace_id, session_id=owner.session_id,
                root_task_id=identifier(), budget_id=identifier(), scope_dependencies=owner.scope_dependencies,
                resource_ids=PolicyService.resource_closure(tx, artifact.dependencies, source_run_id=owner.id),
                config=owner.config.model_copy(update={"catalog": versions}),
                deadline_at=self.clock() + timedelta(seconds=RunLimits().deadline_seconds))
            task = TaskSnapshot(id=run.root_task_id, run_id=run.id, kind="tool", executor_id="builtin.tool", created_seq=1)
            call = ToolInvocation(call_id=meta.command_id, name="artifacts.export", version=versions.tools["artifacts.export"],
                arguments={"artifact_id": artifact_id, "target_ref": target_ref, "expected_target_hash": expected_target_hash})
            emit(tx, run, task.id, "run.started", RuntimeChange(runs=[run], tasks=[task],
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
            if (run.state != "waiting_user" or task.state != "waiting_user" or question.status != "pending"
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
            changed = bump(run, state="running", reason=None)
            emit(tx, changed, task.id, "question.answered", RuntimeChange(runs=[changed],
                tasks=[bump(task, state="running", reason=None)], messages=[message],
                questions=[bump(question, status="answered", answer_message_id=message.id)],
                checkpoints=[bump(checkpoint, pending_call_ids=pending,
                    wait_ids=[id for id in checkpoint.wait_ids if id != question.id],
                    phase="dispatch_tools" if pending else "ready_model",
                    message_boundary=checkpoint.message_boundary + 1)],
                outbox=[OutboxItem(run_id=run.id, task_id=task.id, operation="step")]), meta.command_id)
            return changed, changed
        return self._command("run.answer", {"question_id": question_id, "answer": answer}, meta, RunSnapshot, apply)
