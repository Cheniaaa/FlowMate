"""同一读取事务中的全量费用与最近请求摘要，不依赖展示分页。"""

from collections import Counter

from flowmate.api.contracts import ContextUsageSummary, PricingBasis, RunCostSummary
from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import TERMINAL, ActivitySnapshot, Checkpoint, TaskSnapshot
from flowmate.models.pricing import SCALE
from flowmate.runtime.transitions import check_scopes, load


def model_cost_pending(activity_state, receipt_present, run_state, task_state):
    return (activity_state == "dispatched" and not receipt_present
            and run_state not in TERMINAL and task_state not in TERMINAL)


def cost_summary(tx, run, budget):
    pending = unknown = 0
    for row in tx.execute("SELECT a.document,t.state AS task_state FROM activities a JOIN tasks t ON t.id=a.task_id "
                          "WHERE a.run_id=?", (run.id,)):
        activity = ActivitySnapshot.model_validate_json(row["document"])
        if (activity.intent.kind != "model" or activity.request_digest is None
                or (activity.receipt is not None and activity.receipt.actual_units is not None)):
            continue
        if model_cost_pending(activity.state, activity.receipt is not None, run.state, row["task_state"]):
            pending += 1
        elif activity.state != "prepared":
            unknown += 1
    pricing = run.config.model_pricing
    basis = PricingBasis(source=pricing.source if pricing else None, snapshot_id=pricing.snapshot_id if pricing else None,
        catalog_version=pricing.catalog_version if pricing else None,
        effective_multiplier=pricing.effective_multiplier if pricing else None,
        assumptions=pricing.assumptions if pricing else [], unknown_reason=run.config.pricing_unknown_reason)
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
