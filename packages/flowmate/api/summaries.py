"""同一读取事务中的全量费用与最近请求摘要，不依赖展示分页。"""

from collections import Counter

from flowmate.api.contracts import ContextUsageSummary, PricingBasis, RunCostSummary
from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    TERMINAL,
    AccountingBudget,
    ActivitySnapshot,
    Checkpoint,
    TaskSnapshot,
)
from flowmate.models.pricing import SCALE
from flowmate.runtime.transitions import check_scopes, load

EMBEDDING_OPERATIONS = ("embedding.query", "embedding.document")


def project_budget(tx, budget):
    """保留Run额度与执行计数，费用和请求事实以已退役的无正文归档为准。"""
    if tx is None:
        return budget
    row = tx.execute("SELECT document FROM accounting_budgets WHERE id=? AND run_id=?",
        (budget.id, budget.run_id)).fetchone()
    if row is None:
        return budget
    archived = AccountingBudget.model_validate_json(row[0])
    return budget.model_copy(update=archived.model_dump(include={
        "version", "spent_units", "reserved_units", "model_requests", "total_tokens", "reserved_tokens"}))


def model_cost_pending(activity_state, receipt_present, run_state, task_state):
    return (activity_state == "dispatched" and not receipt_present
            and run_state not in TERMINAL and task_state not in TERMINAL)


def metering_rows(tx, *, run_id=None, session_id=None):
    """按原活动身份读取计量事实；无正文归档优先，退休行不重建执行配置。"""
    selected = "WHERE (? IS NULL OR r.id=?) AND (? IS NULL OR r.interaction_session_id=?) "
    parameters = (run_id, run_id, session_id, session_id)
    return tx.execute(
        "SELECT a.state,r.state AS run_state,t.state AS task_state,"
        "json_extract(a.document,'$.intent.kind') AS kind,"
        "json_extract(a.document,'$.intent.operation') AS operation,"
        "json_extract(a.document,'$.request_digest') IS NOT NULL AS dispatched,"
        "json_type(a.document,'$.receipt')='object' AS receipt_present,"
        "json_extract(a.document,'$.receipt.usage') AS usage,"
        "json_extract(a.document,'$.receipt.actual_units') AS cost,0 AS retired,"
        "EXISTS(SELECT 1 FROM accounting_budgets b WHERE b.run_id=r.id) AS archived_budget "
        "FROM activities a JOIN runs r ON r.id=a.run_id JOIN tasks t ON t.id=a.task_id "
        + selected +
        "AND NOT EXISTS(SELECT 1 FROM accounting_activities retired WHERE retired.id=a.id) "
        "UNION ALL SELECT json_extract(a.document,'$.state'),r.state,NULL,"
        "json_extract(a.document,'$.kind'),json_extract(a.document,'$.operation'),"
        "json_extract(a.document,'$.dispatched'),json_type(a.document,'$.receipt')='object',"
        "json_extract(a.document,'$.receipt.usage'),json_extract(a.document,'$.receipt.actual_units'),1,1 "
        "FROM accounting_activities a JOIN runs r ON r.id=a.run_id "
        + selected, (*parameters, *parameters))


def cost_summary(tx, run, budget):
    # 云向量同样占用model预算并计费；总费用直接来自账本，不使用生成单价重算。
    budget = project_budget(tx, budget)
    pending = unknown = 0
    for row in metering_rows(tx, run_id=run.id):
        if row["kind"] != "model" or not row["dispatched"] or row["cost"] is not None:
            continue
        if not row["retired"] and model_cost_pending(
                row["state"], row["receipt_present"], row["run_state"], row["task_state"]):
            pending += 1
        elif row["state"] != "prepared":
            unknown += 1
    pricing = run.config.model_pricing if run.config.kind == "agent" else None
    basis = PricingBasis(source=pricing.source if pricing else None, snapshot_id=pricing.snapshot_id if pricing else None,
        catalog_version=pricing.catalog_version if pricing else None,
        effective_multiplier=pricing.effective_multiplier if pricing else None,
        assumptions=pricing.assumptions if pricing else [],
        unknown_reason=run.config.pricing_unknown_reason if run.config.kind == "agent" else None)
    return RunCostSummary(calculated_units=budget.spent_units, reserved_units=budget.reserved_units,
        pending_request_count=pending, unknown_request_count=unknown, units_per_currency=SCALE, pricing_basis=basis)


def context_usage(tx, run):
    task = load(tx, TaskSnapshot, run.root_task_id)
    manifest = load(tx, Checkpoint, task.id).context_manifest
    if task.kind != "agent" or not manifest:
        return None
    activity = load(tx, ActivitySnapshot, manifest["activity_id"]) if manifest.get("activity_id") else None
    if activity is None and manifest.get("compaction_state", "none") == "none":
        return None
    counts = Counter()
    for omission in manifest.get("omissions", []):
        counts[omission["reason"]] += len(omission["message_ids"])
    compaction_state = manifest.get("compaction_state", "none")
    compaction_reason = manifest.get("compaction_reason")
    if compaction_state == "running" and task.state in {
            "interrupted", "blocked_incompatible", "failed", "cancelled", "waiting_user"}:
        compaction_state, compaction_reason = "blocked", task.reason or run.reason
    if compaction_state == "committed":
        source_changed = (task.reason or run.reason) in {"scope_revoked", "source_scope_changed", "source_version_conflict"}
        if not source_changed:
            # 已完成运行不会因撤权改变状态，读取时仍须核对原请求的来源。
            try:
                check_scopes(tx, [*run.scope_dependencies, *(activity.intent.dependencies if activity else [])])
            except DomainError as error:
                if error.code != "scope_revoked":
                    raise
                source_changed = True
        if source_changed:
            compaction_state, compaction_reason = "invalidated", "source_changed"
    return ContextUsageSummary(activity_id=activity.id if activity else None, state=activity.state if activity else None,
        omitted_group_count=len(manifest.get("omissions", [])), omitted_message_count=sum(counts.values()), reason_counts=dict(counts),
        compaction_state=compaction_state,
        summary_count=len(manifest.get("summary_ids", [])) if compaction_state != "invalidated" else 0,
        compacted_message_count=len(manifest.get("covered_message_ids", [])) if compaction_state != "invalidated" else 0,
        compaction_reason=compaction_reason)
