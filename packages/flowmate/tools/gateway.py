"""工具调用的唯一执行边界与任务适配。"""

from pathlib import Path
from uuid import UUID, uuid5

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivityIntent,
    ActivityReceipt,
    ActivitySnapshot,
    Checkpoint,
    DispatchRequest,
    ModelMessage,
    ReceiptCommit,
    ReservationEstimate,
    RunOutput,
    RunSnapshot,
    StepDecision,
    TaskSnapshot,
    ToolResultPart,
)
from flowmate.policy.contracts import (
    ApprovalNeeded,
    ExportApprovalPreview,
    PreparedCall,
    ToolInvocation,
    invocation_hash,
)
from flowmate.runtime.transitions import check_scopes, context_for, load
from flowmate.tools.catalog import ToolOutcome


def _merge_dependencies(*groups):
    result = {}
    for group in groups:
        for dependency in group:
            previous = result.get(dependency.scope_id)
            if previous is not None and previous.epoch != dependency.epoch:
                raise DomainError("source_version_conflict", "同一上下文包含冲突的来源版本")
            result[dependency.scope_id] = dependency
    return list(result.values())


class ToolGateway:
    def __init__(self, catalog, policy, approvals, scheduler):
        self.catalog = catalog
        self.policy = policy
        self.approvals = approvals
        self.scheduler = scheduler

    def _bound(self, tx, ctx, call):
        activity = load(tx, ActivitySnapshot, ctx.activity_id)
        actual = context_for(tx, ctx.task_id)
        if (actual != ctx.model_copy(update={"activity_id": None})
                or activity.task_id != ctx.task_id or activity.run_id != ctx.run_id
                or activity.intent.kind != "tool" or activity.state != "prepared"):
            raise DomainError("tool_binding", "工具调用不属于当前未派发活动")
        persisted = ToolInvocation.model_validate(activity.intent.arguments)
        task = load(tx, TaskSnapshot, ctx.task_id)
        if task.binding.config.catalog.tools.get(call.name) != call.version:
            raise DomainError("tool_unavailable", "工具版本不属于当前Run快照")
        tool = self.catalog.get(call.name, call.version)
        internal_merge = (activity.intent.origin == "runtime" and activity.intent.operation == "memory.merge"
            and load(tx, RunSnapshot, ctx.run_id).kind == "maintenance")
        if activity.intent.origin == "runtime" and not internal_merge:
            raise DomainError("tool_binding", "Runtime工具调用不属于维护合并")
        if not tool.spec.model_visible and activity.intent.origin != "user" and not internal_merge:
            raise DomainError("tool_user_only", "此工具只能由用户操作入口发起")
        args = tool.validate_input(call.arguments)
        original_args = tool.validate_input(persisted.arguments)
        if (persisted.call_id, persisted.name, persisted.version, original_args) != (
                call.call_id, call.name, call.version, args) or activity.intent.operation != call.name:
            raise DomainError("tool_binding", "工具参数或调用身份与持久意图不一致")
        uses = tool.resolve_dependencies(tx, ctx, args) if tool.resolve_dependencies else {}
        if set(uses) != set(tool.spec.required_purposes):
            raise DomainError("tool_policy_invalid", "工具用途与来源解析不一致")
        from flowmate.agents.checkpoint import content_dependencies
        dependencies = [*ctx.scope_dependencies, *content_dependencies(load(tx, Checkpoint, ctx.task_id),
            activity.intent.dependencies)]
        remote = tool.spec.mcp
        destination = remote.destination if remote is not None else None
        if remote is not None:
            if task.binding.config.catalog.mcp_tools.get(call.name) != remote:
                raise DomainError("blocked_incompatible", "MCP 原名或目录身份不属于任务快照")
            uses["tool_send"] = [*dependencies, *uses["tool_send"]]
            from flowmate.integrations.permissions import query_grant
            permission = query_grant(tx, ctx, remote, task.binding.config.model_profile.endpoint)
            if permission is not None:
                from flowmate.contracts.execution import ScopeDependency
                dependencies.append(ScopeDependency(scope_id=permission.id, epoch=permission.epoch))
        if call.name == "skills.run_script":
            from flowmate.skills.execution.contracts import process_destination
            destination = process_destination(args["skill_id"], args["content_hash"],
                args["environment_id"], args["environment_revision"])
            uses["local_process_send"] = [*dependencies, *uses["local_process_send"]]
        source_ids = {item.scope_id for item in dependencies}
        for purpose, sources in uses.items():
            source_ids.update(item.scope_id for item in sources)
            decision = self.policy.check_tx(tx, ctx, sources, purpose,
                destination=destination if purpose in {"tool_send", "local_process_send"} else None,
                artifact_id=self.policy.artifact_read_id(persisted.name, persisted.arguments) if purpose == "read" else None)
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "工具所需资料尚未授权",
                                  related_ids=tuple(decision.missing_grants))
            dependencies.extend(decision.dependencies)
        dependencies = _merge_dependencies(dependencies)
        self.policy.check_run_sources(tx, ctx, dependencies)
        check_scopes(tx, dependencies)
        # 孤立grant展开的资源用于本次授权检查，不冒充实际输入的正文版本。
        provenance = [item for item in dependencies if item.scope_id in source_ids or tx.execute(
            "SELECT 1 FROM grants WHERE id=?", (item.scope_id,)).fetchone()]
        # target和依赖只能由已校验参数/可信解析器得到，模型自报字段不授予范围。
        normalized = call.model_copy(update={"arguments": args,
            "dependencies": dependencies,
            "target": destination if destination is not None else args.get("target_ref")})
        return tool, args, normalized, provenance

    def prepare(self, ctx, call):
        with self.scheduler.store.transaction(write=False) as tx:
            tool, args, normalized, provenance = self._bound(tx, ctx, call)
            preview = None
            if normalized.name == "artifacts.export":
                from flowmate.contracts.execution import ArtifactRef

                resource = self.policy.resource(ctx, args["target_ref"], tx=tx)
                artifact = ArtifactRef.model_validate_json(tx.execute(
                    "SELECT document FROM artifacts WHERE id=?", (args["artifact_id"],)).fetchone()[0])
                preview = ExportApprovalPreview(target_path=str(Path(resource.export_target.parent_path) / resource.export_target.name),
                    target_exists=resource.export_target.target_identity is not None,
                    artifact_id=artifact.id, artifact_version=artifact.version)
        approval_id = None
        if tool.spec.requires_approval and not self._query_permitted(ctx, tool):
            approval = self.approvals.propose(normalized, ctx, export_preview=preview, mcp=tool.spec.mcp)
            if approval.status == "pending":
                return ApprovalNeeded(approval=approval)
            if approval.status == "denied":
                raise DomainError("approval_denied", "用户拒绝了此次工具调用")
            approval_id = approval.id
        return PreparedCall(invocation=normalized, source_dependencies=provenance, approval_id=approval_id,
                              grant_epochs=normalized.dependencies)

    def _query_permitted(self, ctx, tool):
        if tool.spec.mcp is None:
            return False
        from flowmate.integrations.permissions import query_grant
        with self.scheduler.store.transaction(write=False) as tx:
            task = load(tx, TaskSnapshot, ctx.task_id)
            return query_grant(tx, ctx, tool.spec.mcp, task.binding.config.model_profile.endpoint) is not None

    async def execute(self, ctx, prepared, cancel, *, before_send=None):
        task_kind = self.scheduler.task(ctx.task_id).kind
        with self.scheduler.store.transaction(write=False) as tx:
            tool, args, normalized, provenance = self._bound(tx, ctx, prepared.invocation)
        if (normalized != prepared.invocation or normalized.dependencies != prepared.grant_epochs
                or provenance != prepared.source_dependencies):
            raise DomainError("tool_binding", "准备后的参数或授权已改变")

        def authorize(tx):
            if cancel.is_set():
                raise DomainError("tool_cancelled", "工具调用已取消")
            _, _, latest, _ = self._bound(tx, ctx, prepared.invocation)
            if latest != normalized:
                raise DomainError("tool_binding", "派发前工具依赖已改变")
            if tool.spec.requires_approval and prepared.approval_id is not None:
                self.approvals.validate(tx, ctx, normalized, prepared.approval_id)
            elif tool.spec.requires_approval:
                from flowmate.integrations.permissions import query_grant
                task = load(tx, TaskSnapshot, ctx.task_id)
                if tool.spec.mcp is None or query_grant(tx, ctx, tool.spec.mcp,
                        task.binding.config.model_profile.endpoint) is None:
                    raise DomainError("approval_required", "公共查询许可已撤销，需要明确工具审批")

        dispatch = before_send or self.scheduler.dispatch

        def send():
            dispatch(DispatchRequest(activity_id=ctx.activity_id,
                attempt_id=self.scheduler.activity(ctx.activity_id).attempt_id,
                request_digest=invocation_hash(normalized), estimate=ReservationEstimate(estimated_units=0),
                source_dependencies=prepared.source_dependencies), authorize=authorize)

        if not tool.deferred_dispatch:
            send()
        try:
            outcome = (await tool.handler(ctx, args, cancel, before_send=send) if tool.deferred_dispatch else
                await tool.handler(ctx, args, cancel))
            if tool.spec.mcp is not None and outcome.result is not None:
                outcome = outcome.model_copy(update={"result": {**outcome.result, "call_id": normalized.call_id}})
            if outcome.error is None:
                result = tool.validate_result(outcome.result)
                outcome = outcome.model_copy(update={"result": result})
        except DomainError as error:
            if tool.deferred_dispatch and self.scheduler.activity(ctx.activity_id).state == "prepared":
                raise
            outcome = ToolOutcome(error=error.code,
                confirmed=getattr(error, "confirmed", not getattr(error, "uncertain", False)))
        observed = {observation.resource_id for observation in outcome.source_observations}
        outcome_dependencies = outcome.dependencies
        if tool.spec.mcp is not None and prepared.approval_id is None:
            # 公共查询结果以本次具体许可为来源。普通 MCP 回执保留 server 来源，
            # 避免同一服务器的私有/写入工具借另一个查询许可回到模型。
            outcome_dependencies = [item for item in outcome_dependencies
                if item.scope_id != tool.spec.mcp.server_id]
        dependencies = _merge_dependencies(
            [item for item in prepared.source_dependencies if item.scope_id not in observed], outcome_dependencies)
        return outcome.model_copy(update={"dependencies": dependencies, "call_id": normalized.call_id,
            "task_kind": task_kind})


class ToolExecutor:
    def __init__(self, gateway):
        self.gateway = gateway

    async def step(self, ctx, checkpoint):
        if checkpoint.tool_call is None:
            return StepDecision(kind="fail", reason="tool_call_missing")
        call = ToolInvocation.model_validate(checkpoint.tool_call)
        tool = self.gateway.catalog.get(call.name, call.version)
        tool.validate_input(call.arguments)
        return StepDecision(kind="activity", intent=ActivityIntent(kind="tool", origin=checkpoint.tool_origin, operation=call.name,
            arguments=call.model_dump(mode="json"), dependencies=_merge_dependencies(ctx.scope_dependencies, call.dependencies)))

    def propose_receipt(self, ctx, checkpoint, outcome):
        message = ModelMessage(id=str(uuid5(UUID(ctx.activity_id), "tool-result:" + outcome.call_id)),
            role="tool", activity_id=ctx.activity_id,
            parts=[ToolResultPart(call_id=outcome.call_id, result=outcome.result, error=outcome.error)],
            source_dependencies=outcome.dependencies)
        decision = StepDecision(kind="continue")
        if outcome.task_kind == "tool":
            decision = (StepDecision(kind="fail", reason=outcome.error) if outcome.error else
                StepDecision(kind="complete", output=RunOutput(summary="工具任务已完成")))
        if outcome.error == "blocked_incompatible":
            decision = StepDecision(kind="wait_user", reason="blocked_incompatible")
        return ReceiptCommit(messages=[message], checkpoint=checkpoint.model_copy(update={
            "message_boundary": checkpoint.message_boundary + 1,
            "pending_call_ids": [id for id in checkpoint.pending_call_ids if id != outcome.call_id],
        }), next_decision=decision, staged_artifacts=outcome.staged_artifacts,
            artifact_refs=[staged.ref for staged in outcome.staged_artifacts],
            source_observations=outcome.source_observations)

    async def drive(self, ctx, activity, cancel, before_send, *, propose=None, normalize=None):
        call = ToolInvocation.model_validate(activity.intent.arguments)
        dependencies = list(activity.intent.dependencies)
        execution_result = None
        try:
            prepared = self.gateway.prepare(ctx, call)
            if isinstance(prepared, ApprovalNeeded):
                return None
            dependencies = prepared.source_dependencies
            outcome = await self.gateway.execute(ctx, prepared, cancel, before_send=before_send)
            execution_result = outcome.result
            if normalize is not None and not self.gateway.scheduler.is_deleted(ctx.run_id):
                outcome = await normalize(ctx, outcome)
            observed = {item.resource_id for item in outcome.source_observations}
            dependencies = _merge_dependencies(dependencies,
                [item for item in outcome.dependencies if item.scope_id not in observed])
        except DomainError as error:
            if self.gateway.scheduler.is_deleted(ctx.run_id):
                raise
            if self.gateway.scheduler.activity(activity.id).state != "prepared":
                raise
            outcome = ToolOutcome(error=error.code, call_id=call.call_id,
                                  task_kind=self.gateway.scheduler.task(ctx.task_id).kind)
        receipt = ActivityReceipt(activity_id=activity.id, attempt_id=activity.attempt_id,
            confirmed=outcome.confirmed, result=execution_result, error=outcome.error,
            actual_units=0, source_dependencies=dependencies, source_observations=outcome.source_observations)
        return receipt, lambda checkpoint: (propose or self.propose_receipt)(ctx, checkpoint, outcome)
