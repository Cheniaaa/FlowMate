"""组总账与Run额度分配；计数、预留、归还及结算只使用调用者事务。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    RunSnapshot,
    RuntimeChange,
)
from flowmate.runtime.transitions import bump, emit, load


def settled_budget(budget, activity, receipt):
    """业务存活或已删除时，都只以同一确定费用事实增量结算。"""
    changes = {}
    previous = activity.receipt
    if receipt.actual_units is not None:
        old = previous.actual_units if previous is not None else None
        if old is not None and old != receipt.actual_units:
            raise DomainError("receipt_conflict", "已确定费用不能被不同回执覆盖")
        if old is None or activity.reserved_units:
            changes.update(spent_units=budget.spent_units + receipt.actual_units - (old or 0),
                           reserved_units=budget.reserved_units - activity.reserved_units)
    tokens = known_tokens(receipt)
    old_tokens = known_tokens(previous) if previous is not None else None
    if tokens is not None and (old_tokens is None or activity.reserved_tokens):
        changes.update(total_tokens=budget.total_tokens + tokens - (old_tokens or 0),
                       reserved_tokens=budget.reserved_tokens - activity.reserved_tokens)
    return bump(budget, **changes) if changes else None


def known_tokens(receipt):
    usage = receipt.usage
    if usage.status == "known" and usage.input_tokens is not None and usage.output_tokens is not None:
        return usage.input_tokens + usage.output_tokens
    return None


# 上限字段与已经消费/在途占用的对应关系；deadline始终取组固定时刻，不可转拨。
DIMENSIONS = {
    "max_steps": ("steps",),
    "max_model_requests": ("model_requests",),
    "max_tasks": ("task_count",),
    "max_cost_units": ("spent_units", "reserved_units"),
    "max_total_tokens": ("total_tokens", "reserved_tokens"),
}


class BudgetService:
    def allocate(self, tx, origin_run_id, target_run_id, limits):
        origin = load(tx, RunSnapshot, origin_run_id)
        budget = load(tx, BudgetSnapshot, origin.budget_id)
        group = load(tx, BudgetGroupSnapshot, origin.budget_group_id)
        allocation = load(tx, BudgetAllocation, origin.id)
        if limits.max_tasks < 1:
            raise DomainError("task_limit", "接管额度必须容纳根任务")
        active = [(BudgetAllocation.model_validate_json(row[0]), BudgetSnapshot.model_validate_json(row[1]))
            for row in tx.execute("SELECT a.document,b.document FROM budget_allocations a "
                "JOIN budgets b ON b.run_id=a.run_id WHERE a.budget_group_id=?",
                (group.id,))]
        remaining = budget.limits.model_dump()
        for field, counters in DIMENSIONS.items():
            cap, requested = getattr(group.limits, field), getattr(limits, field)
            if cap is None:
                # 全组无此上限时，不凭空引入父Run的局部上限复制。
                local = getattr(budget.limits, field)
                if local is not None:
                    if requested is None or requested > local - sum(getattr(budget, name) for name in counters):
                        raise DomainError("allocation_exceeded", "接管超出发起Run未占用额度")
                    remaining[field] -= requested
                continue
            if requested is None:
                raise DomainError("allocation_exceeded", "接管不能去掉组授权上限")
            used = sum(getattr(group, name) for name in counters)
            assigned_unused = sum(max(0, getattr(item.limits, field) - sum(getattr(ledger, name) for name in counters))
                                  for item, ledger in active if not item.returned)
            unassigned = max(0, cap - used - assigned_unused)
            transfer = max(0, requested - unassigned)
            available = max(0, getattr(budget.limits, field) - sum(getattr(budget, name) for name in counters))
            if transfer > available or requested > cap - used:
                raise DomainError("allocation_exceeded", "接管额度不足，须调整授权")
            remaining[field] -= transfer
        for field in ("max_delegation_depth", "max_parallel_agents"):
            if getattr(limits, field) > min(getattr(group.limits, field), getattr(budget.limits, field)):
                raise DomainError("allocation_exceeded", "接管不能扩大委派限制")
        reduced = budget.limits.model_validate(remaining)
        result = BudgetAllocation(group_id=group.id, run_id=target_run_id, limits=limits)
        emit(tx, origin, origin.root_task_id, "budget.allocated", RuntimeChange(
            budgets=[bump(budget, limits=reduced)],
            budget_allocations=[bump(allocation, limits=reduced), result]))
        return result

    def count(self, tx, run_id, counter, *, amount=1):
        run = load(tx, RunSnapshot, run_id)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        group = load(tx, BudgetGroupSnapshot, run.budget_group_id)
        field, reason = {"steps": ("max_steps", "step_limit"),
                         "task_count": ("max_tasks", "task_limit")}[counter]
        for ledger in (budget, group):
            if getattr(ledger, counter) + amount > getattr(ledger.limits, field):
                raise DomainError(reason, "累计授权额度已达上限")
        emit(tx, run, run.root_task_id, "budget.counted", RuntimeChange(
            budgets=[bump(budget, **{counter: getattr(budget, counter) + amount})],
            budget_groups=[bump(group, **{counter: getattr(group, counter) + amount})]))

    def return_unused(self, tx, run_id):
        run = load(tx, RunSnapshot, run_id)
        allocation = load(tx, BudgetAllocation, run_id)
        if allocation.returned:
            return
        budget = load(tx, BudgetSnapshot, run.budget_id)
        # unknown的0金额估计也可能存在；不能仅凭数值零认为无在途。
        if (budget.reserved_units or budget.reserved_tokens or tx.execute(
                "SELECT 1 FROM activities WHERE run_id=? AND state IN ('dispatched','uncertain') LIMIT 1",
                (run.id,)).fetchone()):
            return
        if tx.execute("SELECT 1 FROM activities WHERE run_id=? AND "
                "json_extract(document,'$.receipt.actual_units') IS NULL AND state<>'prepared' LIMIT 1",
                (run.id,)).fetchone():
            return
        emit(tx, run, run.root_task_id, "budget.returned",
             RuntimeChange(budget_allocations=[bump(allocation, returned=True)]))

    def reserve(self, tx, activity_id, estimate, request_kind):
        activity = load(tx, ActivitySnapshot, activity_id)
        run = load(tx, RunSnapshot, activity.run_id)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        group = load(tx, BudgetGroupSnapshot, run.budget_group_id)
        if activity.state != "prepared":
            raise DomainError("already_dispatched", "同一活动不能重复派发")
        cost = estimate.estimated_units
        tokens = estimate.input_estimate + estimate.max_output_tokens if request_kind == "model" else 0
        changed = []
        for ledger in (budget, group):
            cap = ledger.limits.max_cost_units
            if cap is not None:
                if cost is None:
                    raise DomainError("pricing_unknown", "开启金额限制时需要可估算价格")
                if ledger.spent_units + ledger.reserved_units + cost > cap:
                    raise DomainError("budget_exceeded", "剩余金额不足")
            if ledger.model_requests + (request_kind == "model") > ledger.limits.max_model_requests:
                raise DomainError("request_limit", "模型请求次数已达上限")
            token_cap = ledger.limits.max_total_tokens
            if token_cap is not None and ledger.total_tokens + ledger.reserved_tokens + tokens > token_cap:
                raise DomainError("token_limit", "剩余token授权不足")
            changed.append(bump(ledger, reserved_units=ledger.reserved_units + (cost or 0),
                model_requests=ledger.model_requests + (request_kind == "model"),
                reserved_tokens=ledger.reserved_tokens + tokens))
        emit(tx, run, activity.task_id, "budget.reserved",
             RuntimeChange(budgets=[changed[0]], budget_groups=[changed[1]]))
        return activity.id

    def settle(self, tx, receipt):
        activity = load(tx, ActivitySnapshot, receipt.activity_id)
        run = load(tx, RunSnapshot, activity.run_id)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        changed = settled_budget(budget, activity, receipt)
        group = settled_budget(load(tx, BudgetGroupSnapshot, run.budget_group_id), activity, receipt)
        if changed is not None or group is not None:
            emit(tx, run, activity.task_id, "budget.settled", RuntimeChange(
                budgets=[changed] if changed is not None else [],
                budget_groups=[group] if group is not None else []))

    def settle_accounting(self, tx, budget, activity, receipt):
        return (settled_budget(budget, activity, receipt),
                settled_budget(load(tx, BudgetGroupSnapshot, budget.budget_group_id), activity, receipt))
