"""工具调用的唯一执行边界与任务适配。"""

from pathlib import Path
from uuid import UUID, uuid5

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivityIntent,
    ActivityReceipt,
    ActivitySnapshot,
    DispatchRequest,
    ModelMessage,
    ReceiptCommit,
    ReservationEstimate,
    RunOutput,
    RunSnapshot,
    StepDecision,
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
        run = load(tx, RunSnapshot, ctx.run_id)
        if run.config.catalog.tools.get(call.name) != call.version:
            raise DomainError("tool_unavailable", "工具版本不属于当前Run快照")
        tool = self.catalog.get(call.name, call.version)
        if not tool.spec.model_visible and activity.intent.origin != "user":
            raise DomainError("tool_user_only", "此工具只能由用户操作入口发起")
        args = tool.validate_input(call.arguments)
        original_args = tool.validate_input(persisted.arguments)
        if (persisted.call_id, persisted.name, persisted.version, original_args) != (
                call.call_id, call.name, call.version, args) or activity.intent.operation != call.name:
            raise DomainError("tool_binding", "工具参数或调用身份与持久意图不一致")
        uses = tool.resolve_dependencies(tx, ctx, args) if tool.resolve_dependencies else {}
        if set(uses) != set(tool.spec.required_purposes):
            raise DomainError("tool_policy_invalid", "工具用途与来源解析不一致")
        dependencies = [*ctx.scope_dependencies, *activity.intent.dependencies]
        source_ids = {item.scope_id for item in dependencies}
        for purpose, sources in uses.items():
            source_ids.update(item.scope_id for item in sources)
            decision = self.policy.check_tx(tx, ctx, sources, purpose)
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
        normalized = call.model_copy(update={"arguments": args.model_dump(mode="json"),
            "dependencies": dependencies, "target": getattr(args, "target_ref", None)})
        return tool, args, normalized, provenance

    def prepare(self, ctx, call):
        with self.scheduler.store.transaction(write=False) as tx:
            tool, args, normalized, provenance = self._bound(tx, ctx, call)
            preview = None
            if normalized.name == "artifacts.export":
                from flowmate.contracts.execution import ArtifactRef

                resource = self.policy.resource(ctx, args.target_ref, tx=tx)
                artifact = ArtifactRef.model_validate_json(tx.execute(
                    "SELECT document FROM artifacts WHERE id=?", (args.artifact_id,)).fetchone()[0])
                preview = ExportApprovalPreview(target_path=str(Path(resource.export_target.parent_path) / resource.export_target.name),
                    target_exists=resource.export_target.target_identity is not None,
                    artifact_id=artifact.id, artifact_version=artifact.version)
        approval_id = None
        if tool.spec.requires_approval:
            approval = self.approvals.propose(normalized, ctx, export_preview=preview)
            if approval.status == "pending":
                return ApprovalNeeded(approval=approval)
            if approval.status == "denied":
                raise DomainError("approval_denied", "用户拒绝了此次工具调用")
            approval_id = approval.id
        return PreparedCall(invocation=normalized, source_dependencies=provenance, approval_id=approval_id,
                             grant_epochs=normalized.dependencies)

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
            if tool.spec.requires_approval:
                if prepared.approval_id is None:
                    raise DomainError("approval_required", "需要明确工具审批")
                self.approvals.validate(tx, ctx, normalized, prepared.approval_id)

        dispatch = before_send or self.scheduler.dispatch
        dispatch(DispatchRequest(activity_id=ctx.activity_id,
            attempt_id=self.scheduler.activity(ctx.activity_id).attempt_id,
            request_digest=invocation_hash(normalized), estimate=ReservationEstimate(estimated_units=0),
            source_dependencies=prepared.source_dependencies), authorize=authorize)
        try:
            outcome = await tool.handler(ctx, args, cancel)
            if outcome.error is None:
                result = tool.validate_result(outcome.result)
                outcome = outcome.model_copy(update={"result": result})
        except DomainError as error:
            outcome = ToolOutcome(error=error.code, confirmed=not getattr(error, "uncertain", False))
        observed = {observation.resource_id for observation in outcome.source_observations}
        dependencies = _merge_dependencies(
            [item for item in prepared.source_dependencies if item.scope_id not in observed], outcome.dependencies)
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
        return ReceiptCommit(messages=[message], checkpoint=checkpoint.model_copy(update={
            "message_boundary": checkpoint.message_boundary + 1,
            "pending_call_ids": [id for id in checkpoint.pending_call_ids if id != outcome.call_id],
        }), next_decision=decision, staged_artifacts=outcome.staged_artifacts,
            artifact_refs=[staged.ref for staged in outcome.staged_artifacts],
            source_observations=outcome.source_observations)

    async def drive(self, ctx, activity, cancel, before_send, *, propose=None, normalize=None):
        call = ToolInvocation.model_validate(activity.intent.arguments)
        dependencies = list(activity.intent.dependencies)
        try:
            prepared = self.gateway.prepare(ctx, call)
            if isinstance(prepared, ApprovalNeeded):
                return None
            dependencies = prepared.source_dependencies
            outcome = await self.gateway.execute(ctx, prepared, cancel, before_send=before_send)
            if normalize is not None and not self.gateway.scheduler.is_deleted(ctx.run_id):
                outcome = await normalize(ctx, outcome)
        except DomainError as error:
            if self.gateway.scheduler.is_deleted(ctx.run_id):
                raise
            if self.gateway.scheduler.activity(activity.id).state != "prepared":
                raise
            outcome = ToolOutcome(error=error.code, call_id=call.call_id,
                                  task_kind=self.gateway.scheduler.task(ctx.task_id).kind)
        receipt = ActivityReceipt(activity_id=activity.id, attempt_id=activity.attempt_id,
            confirmed=outcome.confirmed, result=outcome.result, error=outcome.error,
            actual_units=0, source_dependencies=dependencies, source_observations=outcome.source_observations)
        return receipt, lambda checkpoint: (propose or self.propose_receipt)(ctx, checkpoint, outcome)
