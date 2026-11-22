"""用户明确选择新接收方后，在原预算组中复用工具图片续办。"""

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    TERMINAL,
    ActivitySnapshot,
    ArtifactRef,
    BudgetAllocation,
    BudgetGroupSnapshot,
    BudgetSnapshot,
    ModelMessage,
    RuntimeChange,
    StartRun,
    TaskSnapshot,
    ToolResultPart,
)
from flowmate.runtime.budget import DIMENSIONS
from flowmate.runtime.transitions import bump, context_for, emit, load, stop_run


def continue_vision(service, tx, original, profile_id, meta, *, expected=None):
    service._check_version(original, meta)
    if original.interaction_session_id is None:
        raise DomainError("vision_source_invalid", "图片任务没有可续办的会话")
    if tx.execute("SELECT 1 FROM pending_user_commands WHERE session_id=? AND state='queued'",
            (original.interaction_session_id,)).fetchone():
        raise DomainError("session_busy", "请先处理当前会话已接收的输入")
    if original.state not in {*TERMINAL, "waiting_user", "blocked_incompatible"}:
        raise DomainError("vision_source_busy", "请等待当前任务停止后再选择视觉模型")
    if tx.execute("SELECT 1 FROM activities WHERE run_id=? AND state IN ('prepared','dispatched','uncertain')",
            (original.id,)).fetchone():
        raise DomainError("vision_source_busy", "原任务仍有未确认的调用，暂不能续办")
    refs = {}
    has_image = False
    for row in tx.execute("SELECT document FROM messages WHERE task_id=? ORDER BY rowid",
            (original.root_task_id,)):
        message = ModelMessage.model_validate_json(row[0])
        for part in message.parts:
            if not isinstance(part, ToolResultPart) or not isinstance(part.result, dict) or message.activity_id is None:
                continue
            activity = load(tx, ActivitySnapshot, message.activity_id)
            if activity.mcp_source is None:
                continue
            result = part.result
            for item in result.get("content", []):
                if item["type"] == "image":
                    ref = ArtifactRef.model_validate(item["artifact"])
                    saved = tx.execute("SELECT run_id,document FROM artifacts WHERE id=?", (ref.id,)).fetchone()
                    if (saved is None or saved[0] != original.id or ref.activity_id != activity.id
                            or ArtifactRef.model_validate_json(saved[1]) != ref):
                        raise DomainError("artifact_corrupt", "原任务图片产物已不可用")
                    refs[ref.id] = ref
                    has_image = True
            if result.get("truncated") is True:
                for key in ("artifact_id", "structured_artifact_id"):
                    if key not in result:
                        continue
                    saved = tx.execute("SELECT document FROM artifacts WHERE id=? AND run_id=?",
                        (result[key], original.id)).fetchone()
                    if saved is None:
                        raise DomainError("artifact_corrupt", "原调用的回执产物不可用")
                    ref = ArtifactRef.model_validate_json(saved[0])
                    if ref.activity_id != activity.id or ref.media_type not in {"text/plain", "application/json"}:
                        raise DomainError("artifact_corrupt", "原调用的回执产物与引用不一致")
                    refs[ref.id] = ref
    if not has_image:
        raise DomainError("vision_source_missing", "原任务没有已保存的工具图片")
    group = load(tx, BudgetGroupSnapshot, original.budget_group_id)
    if service.clock() >= group.deadline_at:
        raise DomainError("deadline_exceeded", "原任务预算期限已过，请调整预算后继续")
    limits = group.limits.model_dump()
    ledgers = [(BudgetAllocation.model_validate_json(row[0]), BudgetSnapshot.model_validate_json(row[1]))
        for row in tx.execute("SELECT a.document,b.document FROM budget_allocations a "
            "JOIN budgets b ON b.run_id=a.run_id WHERE a.budget_group_id=?", (group.id,))]
    for field, counters in DIMENSIONS.items():
        cap = getattr(group.limits, field)
        if cap is not None:
            occupied = sum(max(0, getattr(allocation.limits, field)
                - sum(getattr(budget, key) for key in counters)) for allocation, budget in ledgers
                if not allocation.returned and allocation.run_id != original.id)
            limits[field] = max(0, cap - sum(getattr(group, key) for key in counters) - occupied)
    if limits["max_tasks"] < 1 or limits["max_model_requests"] < 1 or limits["max_steps"] < 1:
        raise DomainError("allocation_exceeded", "原任务剩余预算不足，请调整预算后继续")
    from flowmate.contracts.base import CommandMeta

    pending = service._receive(tx, StartRun(session_id=original.interaction_session_id,
        agent_profile_id=original.config.agent_profile.id, model_profile_id=profile_id,
        text="请使用原任务已保存的工具图片与文字，继续回答原始问题。不要重新执行原工具。",
        sources=original.sources, limits=group.limits.model_validate(limits)), CommandMeta(),
        file_inputs=original.file_inputs)
    profile = pending.config.model_profile
    if expected is not None and (profile.id, profile.version, profile.connection_version, profile.endpoint) != (
            expected.model_profile_id, expected.model_profile_version, expected.connection_version, expected.endpoint):
        raise DomainError("model_destination_changed", "所选模型或接收方已变化，请重新选择并确认")
    if pending.config.model_profile.capabilities.vision is False:
        raise DomainError("vision_model_required", "所选型号只支持文本，请选择可看图的型号")
    if not service.policy.same_model_recipient(original.config.model_profile, profile):
        files = set(original.file_inputs)
        for id in original.sources.resource_ids:
            row = tx.execute("SELECT json_extract(document,'$.kind') FROM resources WHERE id=?", (id,)).fetchone()
            if row is not None and row[0] == "file":
                files.add(id)
        sources = original.sources.model_copy(update={
            "resource_ids": [id for id in original.sources.resource_ids if id not in files]})
        pending = pending.model_copy(update={"start": pending.start.model_copy(update={"sources": sources}),
            "file_inputs": {}})
    # 后续只允许读取已保存材料和提交答复；原 MCP 调用不在新目录中。
    catalog = pending.config.catalog.model_copy(update={"mcp_tools": {}, "tools": {
        name: version for name, version in pending.config.catalog.tools.items()
        if name in {"run.finish", "artifacts.read"}}})
    pending = pending.model_copy(update={"config": pending.config.model_copy(update={
        "agent_profile": original.config.agent_profile, "members": {}, "catalog": catalog}),
        "deadline_at": group.deadline_at})
    if original.state not in TERMINAL:
        original = stop_run(tx, original, "cancelled", "vision_continued")
    run = service._start_tx(tx, pending, origin=original)
    task = load(tx, TaskSnapshot, run.root_task_id)
    run = bump(run, vision_source_run_id=original.id)
    task = bump(task, origin_task_id=original.root_task_id,
        binding=task.binding.model_copy(update={"input_artifacts": list(refs.values())}))
    emit(tx, run, task.id, "task.stepped", RuntimeChange(runs=[run], tasks=[task]))
    ctx = context_for(tx, task.id)
    dependencies = [dependency for ref in refs.values() for dependency in ref.dependencies]
    service.policy.check_run_sources(tx, ctx, dependencies,
        source_run_id=original.id, source_task_id=original.root_task_id)
    decision = service.policy.check_tx(tx, ctx, dependencies, "model_send", run.config.model_profile.endpoint)
    if not decision.allowed:
        raise DomainError("context_authorization_required", "新接收方无权使用原任务资料，请检查资料范围和授权")
    return run
