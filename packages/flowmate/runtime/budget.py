"""Run共享预算；派发预留和迟到结算均使用调用者事务。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    BudgetSnapshot,
    RunSnapshot,
    RuntimeChange,
)
from flowmate.runtime.transitions import bump, emit, load


def settled_budget(budget, activity, receipt):
    """业务存活或已删除时，都只以同一确定费用事实增量结算。"""
    previous = activity.receipt.actual_units if activity.receipt is not None else None
    actual = receipt.actual_units
    if actual is None or (actual == previous and activity.reserved_units == 0):
        return None
    if previous is not None and previous != actual:
        raise DomainError("receipt_conflict", "已确定费用不能被不同回执覆盖")
    return bump(budget, spent_units=budget.spent_units + actual - (previous or 0),
                reserved_units=budget.reserved_units - activity.reserved_units)


class BudgetService:
    def reserve(self, tx, activity_id, estimate, request_kind):
        activity = load(tx, ActivitySnapshot, activity_id)
        run = load(tx, RunSnapshot, activity.run_id)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        if activity.state != "prepared":
            raise DomainError("already_dispatched", "同一活动不能重复派发")
        cost = estimate.estimated_units
        cap = budget.limits.max_cost_units
        if cap is not None:
            if cost is None:
                raise DomainError("pricing_unknown", "开启金额限制时需要可估算价格")
            if budget.spent_units + budget.reserved_units + cost > cap:
                raise DomainError("budget_exceeded", "剩余金额不足")
        requests = budget.model_requests + (request_kind == "model")
        if requests > budget.limits.max_model_requests:
            raise DomainError("request_limit", "模型请求次数已达上限")
        changed = bump(budget, reserved_units=budget.reserved_units + (cost or 0),
                       model_requests=requests)
        emit(tx, run, activity.task_id, "budget.reserved", RuntimeChange(budgets=[changed]))
        return activity.id

    def settle(self, tx, receipt):
        activity = load(tx, ActivitySnapshot, receipt.activity_id)
        run = load(tx, RunSnapshot, activity.run_id)
        budget = load(tx, BudgetSnapshot, run.budget_id)
        changed = settled_budget(budget, activity, receipt)
        if changed is not None:
            emit(tx, run, activity.task_id, "budget.settled", RuntimeChange(budgets=[changed]))
