"""摘要记录随原 Scheduler 回执事务提交；读取返回有效覆盖和明确失效原因。"""

from typing import Literal
from uuid import UUID, uuid5

from pydantic import Field, ValidationError

from flowmate.context.compaction import (
    CompactionPlan,
    ContextSummary,
    _digest,
    _json,
    _SummaryContent,
)
from flowmate.contracts.base import Contract, Count, DomainError, Id
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ArtifactRef,
    Checkpoint,
    ModelMessage,
    ResultConsumption,
    TaskSnapshot,
)
from flowmate.runtime.leases import owns_session
from flowmate.runtime.transitions import check_dispatch, check_scopes, load


class CommittedContextSummary(Contract):
    id: Id
    task_id: Id
    activity_id: Id
    attempt_id: Id
    start_boundary: Count
    end_boundary: Count
    plan_digest: str
    request_digest: str
    summary: ContextSummary
    artifact: ArtifactRef
    source_hashes: dict[Id, str]
    result_consumptions: dict[Id, ResultConsumption]


class SummaryOmission(Contract):
    summary_id: Id
    reason: Literal["source_invalid", "artifact_invalid", "receipt_invalid"]


class ContextSummarySelection(Contract):
    summaries: list[CommittedContextSummary] = Field(default_factory=list)
    covered_message_ids: list[Id] = Field(default_factory=list)
    omissions: list[SummaryOmission] = Field(default_factory=list)


def _owner(strategy, tx, ctx):
    checkpoint = load(tx, Checkpoint, ctx.task_id)
    run, task, _ = strategy.builder._owner(
        tx, ctx, checkpoint, load(tx, TaskSnapshot, ctx.task_id).binding.config.model_profile, [])
    check_scopes(tx, ctx.scope_dependencies)
    return run, task, checkpoint


def _receipt_summary(strategy, plan, summary, ctx, receipt):
    if (receipt.activity_id != ctx.activity_id or not receipt.confirmed or receipt.error is not None
            or receipt.source_observations):
        raise DomainError("compaction_binding", "摘要须来自当前活动的成功完整模型回执")
    try:
        response = ModelMessage.model_validate(receipt.result)
    except ValidationError:
        raise DomainError("invalid_compaction_summary", "摘要回执缺少真实模型消息") from None
    if response.activity_id != ctx.activity_id:
        raise DomainError("compaction_binding", "摘要响应不属于当前活动")
    if strategy.summary(plan, response, artifact_id=summary.artifact_id) != summary:
        raise DomainError("invalid_compaction_summary", "摘要不等于实际模型回执")


def _artifact(strategy, tx, ctx, artifact, summary):
    actual = strategy.artifacts.reference(ctx, summary.artifact_id, tx=tx,
        artifact_version=artifact.version, content_hash=artifact.content_hash)
    if actual != artifact or (actual.task_id, actual.activity_id) != (ctx.task_id, ctx.activity_id):
        raise DomainError("compaction_binding", "摘要产物不属于原 Task 和模型活动的固定版本")
    decision = strategy.policy.check_tx(tx, ctx, actual.dependencies, "read", artifact_id=actual.id)
    if not decision.allowed:
        raise DomainError("context_authorization_required", "摘要产物缺少读取授权")
    try:
        content = _SummaryContent.model_validate_json(strategy.artifacts._bytes(actual))
    except ValidationError:
        raise DomainError("invalid_compaction_summary", "摘要产物正文不符合结构化契约") from None
    if content.model_dump() != summary.model_dump(exclude={"artifact_id"}):
        raise DomainError("invalid_compaction_summary", "已发布产物正文与摘要不一致")


def commit_summary_tx(strategy, tx, ctx, plan, summary, *, receipt, artifact):
    """仅供 Scheduler 内容提交分支调用；不打开事务，不发布/结算 Activity。"""
    if strategy.artifacts is None:
        raise DomainError("artifact_unavailable", "摘要产物服务未装配")
    run, task, checkpoint = _owner(strategy, tx, ctx)
    if ctx.activity_id is None or plan.task_id != ctx.task_id:
        raise DomainError("compaction_binding", "摘要提交缺少原 Task 的模型活动身份")
    activity = load(tx, ActivitySnapshot, ctx.activity_id)
    if (activity.run_id, activity.task_id, activity.attempt_id) != (
            ctx.run_id, ctx.task_id, receipt.attempt_id):
        raise DomainError("attempt_mismatch", "摘要回执不属于当前 Task 的实际活动尝试")
    _receipt_summary(strategy, plan, summary, ctx, receipt)
    _artifact(strategy, tx, ctx, artifact, summary)
    required = {(item.scope_id, item.epoch) for item in plan.dependencies}
    if not required <= {(item.scope_id, item.epoch) for item in artifact.dependencies}:
        raise DomainError("compaction_binding", "摘要产物丢失原压缩材料的来源依赖")
    record_id = str(uuid5(UUID(activity.id), "context.summary"))
    previous = tx.execute("SELECT document FROM context_summaries WHERE id=?", (record_id,)).fetchone()
    if previous is not None:
        saved = CommittedContextSummary.model_validate_json(previous[0])
        if (saved.plan_digest != _digest(plan.model_dump(mode="json"))
                or saved.summary != summary or saved.artifact != artifact):
            raise DomainError("compaction_conflict", "同一模型活动不能替换已提交摘要")
        if activity.state == "succeeded" and activity.content_committed and activity.receipt == receipt:
            return
    if (activity.state != "dispatched" or checkpoint.phase != "waiting_compaction"
            or checkpoint.pending_activity_ids != [activity.id] or checkpoint.pending_call_ids
            or checkpoint.version <= plan.checkpoint_version
            or checkpoint.context_manifest.get("compaction") is None
            or CompactionPlan.model_validate_json(_json(checkpoint.context_manifest["compaction"])) != plan):
        raise DomainError("compaction_binding", "摘要没有固定的持久压缩阶段和待处理活动")
    expected = strategy._intent(plan)
    if ((activity.intent.kind, activity.intent.origin, activity.intent.operation, activity.intent.arguments)
            != (expected.kind, expected.origin, expected.operation, expected.arguments)):
        raise DomainError("compaction_binding", "已派发模型活动与固定压缩请求不一致")
    if not required <= {(item.scope_id, item.epoch) for item in activity.intent.dependencies}:
        raise DomainError("compaction_binding", "已派发模型活动丢失压缩来源")
    check_dispatch(tx, run, task, strategy.policy.clock())
    if (run.execution_session_id == run.interaction_session_id and not owns_session(
            tx, run.interaction_session_id, run.id, generation=activity.lease_generation)):
        raise DomainError("compaction_binding", "摘要活动的会话租约代次已失效")
    original = strategy._validate_plan_tx(tx, ctx, checkpoint, plan, ready=False)
    if previous is not None:
        return
    selected = read_summaries_tx(strategy, tx, ctx)
    if set(selected.covered_message_ids) != set(plan.covered_message_ids):
        raise DomainError("version_conflict", "既有有效摘要覆盖已改变，不能重复或跳过材料")
    source_ids = set(plan.message_ids) | set(plan.authority_message_ids) | set(plan.protected_message_ids)
    record = CommittedContextSummary(
        id=record_id, task_id=task.id, activity_id=activity.id, attempt_id=activity.attempt_id,
        start_boundary=min(index for index, message in enumerate(original) if message.id in plan.message_ids),
        end_boundary=plan.source_boundary, plan_digest=_digest(plan.model_dump(mode="json")),
        request_digest=activity.request_digest, summary=summary, artifact=artifact,
        source_hashes={message.id: _digest(message.model_dump(mode="json"))
            for message in original if message.id in source_ids},
        result_consumptions={id: value for id, value in plan.result_consumptions.items() if id in source_ids})
    tx.execute("INSERT INTO context_summaries "
        "(id,task_id,start_boundary,end_boundary,activity_id,artifact_id,artifact_version,document) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (record.id, record.task_id, record.start_boundary, record.end_boundary,
            record.activity_id, record.artifact.id, record.artifact.version, record.model_dump_json()))


def read_summaries_tx(strategy, tx, ctx) -> ContextSummarySelection:
    """和后续 builder 共用读快照；失效正文不返回，覆盖不包含后来追加的新材料。"""
    if strategy.artifacts is None:
        raise DomainError("artifact_unavailable", "摘要产物服务未装配")
    _, task, _ = _owner(strategy, tx, ctx)
    selected = ContextSummarySelection()
    rows = tx.execute("SELECT * FROM context_summaries WHERE task_id=? ORDER BY rowid",
        (ctx.task_id,)).fetchall()
    for row in rows:
        record = CommittedContextSummary.model_validate_json(row["document"])
        if (row["id"], row["task_id"], row["start_boundary"], row["end_boundary"], row["activity_id"],
                row["artifact_id"], row["artifact_version"]) != (
                record.id, record.task_id, record.start_boundary, record.end_boundary, record.activity_id,
                record.artifact.id, record.artifact.version):
            raise DomainError("context_summary_invalid", "摘要索引与持久身份不一致")
        source_messages = []
        reason = None
        for id, digest in record.source_hashes.items():
            message = tx.execute("SELECT document FROM messages WHERE id=? AND task_id=? "
                "AND run_id=? AND execution_session_id=?", (id, ctx.task_id, ctx.run_id, ctx.session_id)).fetchone()
            if message is None:
                reason = "source_invalid"
                break
            actual = ModelMessage.model_validate_json(message[0])
            if _digest(actual.model_dump(mode="json")) != digest:
                reason = "source_invalid"
                break
            source_messages.append(actual)
        if reason is None:
            try:
                for message in source_messages:
                    strategy.policy.check_run_sources(tx, ctx, message.source_dependencies,
                        source_run_id=ctx.run_id, source_task_id=ctx.task_id)
                strategy.builder._authorize(tx, ctx, task.binding.config.model_profile, record.artifact.dependencies)
                if strategy._result_consumptions(tx, ctx, source_messages) != record.result_consumptions:
                    reason = "source_invalid"
            except DomainError as error:
                if error.code not in {"scope_revoked", "scope_mismatch", "outside_run_scope", "not_found",
                        "source_version_conflict", "context_authorization_required", "context_incomplete"}:
                    raise
                reason = "source_invalid"
        summary_ctx = ctx.model_copy(update={"activity_id": record.activity_id})
        if reason is None:
            try:
                _artifact(strategy, tx, summary_ctx, record.artifact, record.summary)
            except DomainError as error:
                if error.code not in {"artifact_not_found", "artifact_missing", "artifact_corrupt",
                        "artifact_scope_mismatch", "version_conflict", "compaction_binding",
                        "invalid_compaction_summary"}:
                    raise
                reason = "artifact_invalid"
        if reason is None:
            activity = load(tx, ActivitySnapshot, record.activity_id)
            if (activity.state != "succeeded" or not activity.content_committed or activity.receipt is None
                    or activity.receipt.error is not None or not activity.receipt.confirmed
                    or activity.attempt_id != record.attempt_id or activity.request_digest != record.request_digest
                    or (activity.run_id, activity.task_id) != (ctx.run_id, ctx.task_id)):
                reason = "receipt_invalid"
        if reason is not None:
            selected.omissions.append(SummaryOmission(summary_id=record.id, reason=reason))
            continue
        if set(selected.covered_message_ids) & set(record.summary.covered_message_ids):
            raise DomainError("context_summary_invalid", "有效摘要不能重复覆盖同一消息")
        selected.summaries.append(record)
        selected.covered_message_ids.extend(record.summary.covered_message_ids)
    return selected


def delete_scope_tx(tx, scope):
    """供现有 apply_deletion 在删除 Task/Activity/Artifact 父行前调用。"""
    if scope.kind == "user_global":
        raise DomainError("invalid_scope", "上下文摘要属于真实任务范围")
    where, parameters = "workspace_id=?", (scope.workspace_id,)
    if scope.session_id is not None:
        where += " AND interaction_session_id=?"
        parameters = (*parameters, scope.session_id)
    tx.execute("DELETE FROM context_summaries WHERE task_id IN "
        f"(SELECT id FROM tasks WHERE run_id IN (SELECT id FROM runs WHERE {where}))", parameters)
