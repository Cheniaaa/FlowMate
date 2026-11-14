"""同一读取事务中的全量费用与最近请求摘要，不依赖展示分页。"""

from collections import Counter

from flowmate.api.contracts import ContextUsageSummary, PricingBasis, RunCostSummary
from flowmate.contracts.execution import TERMINAL, ActivitySnapshot, Checkpoint, TaskSnapshot
from flowmate.models.pricing import SCALE
from flowmate.runtime.transitions import load


def cost_summary(tx, run, budget):
    pending = unknown = 0
    for row in tx.execute("SELECT a.document,t.state AS task_state FROM activities a JOIN tasks t ON t.id=a.task_id "
                          "WHERE a.run_id=?", (run.id,)):
        activity = ActivitySnapshot.model_validate_json(row["document"])
        if (activity.intent.kind != "model" or activity.request_digest is None
                or (activity.receipt is not None and activity.receipt.actual_units is not None)):
            continue
        if (activity.state == "dispatched" and activity.receipt is None
                and run.state not in TERMINAL and row["task_state"] not in TERMINAL):
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
    activity = load(tx, ActivitySnapshot, manifest["activity_id"])
    counts = Counter()
    for omission in manifest["omissions"]:
        counts[omission["reason"]] += len(omission["message_ids"])
    return ContextUsageSummary(activity_id=activity.id, state=activity.state,
        omitted_group_count=len(manifest["omissions"]), omitted_message_count=sum(counts.values()), reason_counts=dict(counts))
