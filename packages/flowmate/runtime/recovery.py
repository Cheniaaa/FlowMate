"""只从已提交事实恢复，不重放外部操作。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    RunSnapshot,
    RuntimeChange,
    TaskSnapshot,
)
from flowmate.runtime.transitions import bump, emit


def recover(store, *, catalog=None):
    from flowmate.runtime.service import RuntimeCatalog

    available = (RuntimeCatalog(catalog.tools, catalog.plugins, agent_executor_id=catalog.agent_executor_id)
                 if catalog is not None else None)
    with store.transaction() as tx:
        for row in tx.execute("SELECT document FROM runs WHERE state NOT IN ('completed','failed','cancelled') "
                              "OR EXISTS(SELECT 1 FROM activities a WHERE a.run_id=runs.id AND a.state='dispatched')").fetchall():
            run = RunSnapshot.model_validate_json(row[0])
            activities = []
            for row in tx.execute("SELECT document FROM activities WHERE run_id=? AND state='dispatched'",
                                  (run.id,)):
                activities.append(bump(ActivitySnapshot.model_validate_json(row[0]), state="uncertain"))
            if run.state in TERMINAL:
                emit(tx, run, run.root_task_id, "runtime.recovered", RuntimeChange(activities=activities))
                continue
            incompatible = False
            if available is not None:
                try:
                    available.require_available(run.config.catalog)
                except DomainError:
                    incompatible = True
            runnable = tx.execute("SELECT 1 FROM tasks WHERE run_id=? AND state IN ('queued','running')",
                                  (run.id,)).fetchone()
            needs_stop = bool(runnable) or bool(activities)
            tasks = []
            if needs_stop:
                for row in tx.execute("SELECT document FROM tasks WHERE run_id=? AND state IN "
                                      "('queued','running')", (run.id,)):
                    task = TaskSnapshot.model_validate_json(row[0])
                    tasks.append(bump(task, state="interrupted", reason="runtime_restart"))
            if activities or needs_stop or incompatible:
                changed = bump(run, state="blocked_incompatible" if incompatible else "interrupted",
                               reason="plugin_or_tool_version_unavailable" if incompatible else "runtime_restart")
                emit(tx, changed, run.root_task_id, "runtime.recovered",
                     RuntimeChange(runs=[changed], tasks=tasks, activities=activities))
