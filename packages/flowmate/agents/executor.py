"""Agent一步一提交，外部工作结束后才生成纯回执提议。"""

import asyncio
import json

from pydantic import TypeAdapter, ValidationError

from flowmate.agents.checkpoint import (
    ControlResult,
    agent_output_validator,
    answer_validator,
    content_dependencies,
    model_tool_visible,
)
from flowmate.artifacts.tool_results import tool_result_bytes, tool_result_projection
from flowmate.context.compaction import CompactionPlan, ContextCompaction
from flowmate.contracts.base import CallId, DomainError
from flowmate.contracts.execution import (
    ActivityIntent,
    ActivitySnapshot,
    AgentResult,
    Checkpoint,
    ModelMessage,
    Question,
    ReceiptCommit,
    RunOutput,
    RunSnapshot,
    ScopeDependency,
    StepDecision,
    TaskSnapshot,
    TextPart,
    TextSlice,
    ToolCallPart,
    ToolResultPart,
)
from flowmate.models.contracts import ModelOutcome, ModelRequest
from flowmate.models.tool_names import wire_names
from flowmate.models.wire import strict_json
from flowmate.policy.contracts import ToolInvocation
from flowmate.runtime.budget import BudgetService
from flowmate.runtime.tasks import child_failure_feedback
from flowmate.runtime.transitions import check_scopes, load, utc_now
from flowmate.tools.catalog import ToolArgumentsError


class AgentExecutor:
    def __init__(self, store, catalog, model, tools, context=None, *, policy, artifacts, clock=None,
                 emit_delta=None, emit_reasoning_delta=None, maintenance=None):
        self.store = store
        self.catalog = catalog
        self.model = model
        self.tools = tools
        self.policy = policy
        self.artifacts = artifacts
        if context is None:
            from flowmate.context.builder import ContextBuilder
            context = ContextBuilder(store, policy, estimate=lambda ctx, request: self.model.estimate(ctx, request),
                artifacts=artifacts)
        self.context = context
        self.compaction = ContextCompaction(store, policy,
            estimate=lambda ctx, request: self.model.estimate(ctx, request), artifacts=artifacts)
        self.clock = clock or utc_now
        self.emit_delta = emit_delta
        self.emit_reasoning_delta = emit_reasoning_delta
        self.maintenance = maintenance

    def _calls(self, ctx, checkpoint):
        with self.store.transaction(write=False) as tx:
            rows = tx.execute("SELECT document FROM messages WHERE task_id=? ORDER BY rowid DESC",
                              (ctx.task_id,)).fetchall()
        for row in rows:
            message = ModelMessage.model_validate_json(row[0])
            if message.role == "assistant":
                calls = [part for part in message.parts if isinstance(part, ToolCallPart)]
                if calls:
                    wanted = set(checkpoint.pending_call_ids)
                    selected = [part for part in calls if part.call_id in wanted]
                    if len(selected) != len(wanted):
                        raise DomainError("checkpoint_invalid", "待完成调用缺少原始消息")
                    return message, selected
        raise DomainError("checkpoint_invalid", "待完成调用缺少原始消息")

    def _control(self, ctx, checkpoint, message, call, run):
        remaining = [id for id in checkpoint.pending_call_ids if id != call.call_id]
        next_checkpoint = checkpoint.model_copy(update={"pending_call_ids": remaining,
            "phase": "dispatch_tools" if remaining else "ready_model",
            "message_boundary": checkpoint.message_boundary + 1})
        def result(error=None, reason=None):
            return ModelMessage(role="tool", parts=[ToolResultPart(call_id=call.call_id, origin_message_id=message.id,
                result=ControlResult(accepted=error is None, reason=reason).model_dump(mode="json")
                if error is None or reason is not None else None, error=error)],
                source_dependencies=message.source_dependencies)
        try:
            with self.store.transaction(write=False) as tx:
                task = load(tx,TaskSnapshot,ctx.task_id)
            tool = self.catalog.get(call.name, task.binding.config.catalog.tools[call.name])
            args = tool.validate_input(call.arguments)
            if call.name == "user.ask":
                answer_validator(args["answer_schema"])
                question = Question(run_id=run.id, task_id=ctx.task_id, call_id=call.call_id,
                    message_id=message.id, question=args["question"], answer_schema=args["answer_schema"],
                    dependencies=message.source_dependencies)
                return StepDecision(kind="wait_user", reason="question", question=question,
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user", "wait_ids": [question.id]}))
            with self.store.transaction(write=False) as tx:
                check_scopes(tx, message.source_dependencies)
                output = (AgentResult if task.binding.agent_work is not None else RunOutput).model_validate(args["output"])
                if task.binding.agent_work is not None:
                    if call.name != "agent.finish":
                        raise DomainError("invalid_output", "成员必须提交明确结构化交付")
                    if len(output.model_dump_json().encode("utf-8")) > self.artifacts.config.max_tool_context_bytes:
                        raise DomainError("invalid_output", "成员交付超出上下文预算，详细内容须写入Artifact")
                    from jsonschema.exceptions import ValidationError
                    from referencing.exceptions import Unresolvable
                    if output.status != "failed" or output.structured_result is not None:
                        try:
                            agent_output_validator(task.binding.agent_work.output_schema).validate(output.structured_result)
                        except (ValidationError, Unresolvable):
                            raise DomainError("invalid_output", "成员交付不满足固定Schema") from None
                    for id in output.evidence_refs:
                        if tx.execute("SELECT 1 FROM artifacts WHERE id=?", (id,)).fetchone():
                            self.artifacts.validate_output(tx, ctx, [id])
                        else:
                            resource = self.policy.resource(ctx, id, tx=tx)
                            self.policy.check_run_sources(tx, ctx, [
                                ScopeDependency(scope_id=id, epoch=resource.version)])
                elif output.unresolved:
                    raise DomainError("invalid_output", "unresolved表示尚未满足的任务要求，非空时不能完成。"
                        "若用户要求保留业务待确认事项，请写入summary或Artifact；仅在任务要求均已满足时传空列表。"
                        "真正未完成的要求须继续处理，不能为了完成而清空。")
                from flowmate.runtime.recovery import has_pending_activities
                if (remaining or not (output.summary.strip() or output.artifact_ids)
                        or has_pending_activities(tx, ctx.task_id)):
                    raise DomainError("invalid_output", "完成要求尚未满足")
                self.artifacts.validate_output(tx, ctx, output.artifact_ids)
                feedback = (None if isinstance(output, AgentResult) and output.status == "failed"
                            else child_failure_feedback(tx, task, checkpoint, output))
                if feedback is not None:
                    fresh, reason = feedback
                    rejected = [result("unhandled_child_failure", reason)]
                    if fresh is None:
                        return StepDecision(kind="fail", reason="unhandled_child_failure",
                            messages=rejected, checkpoint=next_checkpoint)
                    manifest = {**checkpoint.context_manifest, "child_failure_feedback": fresh}
                    return StepDecision(kind="continue", messages=rejected,
                        checkpoint=next_checkpoint.model_copy(update={"context_manifest": manifest}))
            # 完成提议先提交控制结果，再经安全边界复核新steering/持久义务。
            return StepDecision(kind="continue", messages=[result()], checkpoint=next_checkpoint.model_copy(
                update={"phase": "preparing_structured_output" if isinstance(output, AgentResult)
                        and output.status != "failed" else "preparing_output", "output": output,
                        "output_dependencies": message.source_dependencies}))
        except (DomainError, KeyError) as error:
            code = error.code if isinstance(error, DomainError) else "tool_unavailable"
            reason = error.safe_message if code == "invalid_output" else None
            return StepDecision(kind="continue", messages=[result(code, reason)], checkpoint=next_checkpoint)

    async def step(self, ctx, checkpoint):
        with self.store.transaction(write=False) as tx:
            run = load(tx, RunSnapshot, ctx.run_id)
            task = load(tx,TaskSnapshot,ctx.task_id)
            current = load(tx, Checkpoint, ctx.task_id)
            if current != checkpoint:
                raise DomainError("version_conflict", "检查点已推进")
            steering = [ModelMessage.model_validate_json(row[0]).id for row in tx.execute(
                "SELECT document FROM messages WHERE task_id=? ORDER BY rowid", (ctx.task_id,))
                if ModelMessage.model_validate_json(row[0]).origin == "steering"]
        if checkpoint.pending_activity_ids:
            raise DomainError("activities_pending", "仍有未提交的活动")
        if run.kind == "maintenance":
            if self.maintenance is None:
                raise DomainError("blocked_incompatible", "维护执行服务未装配")
            try:
                decision = self.maintenance.before_step(ctx, checkpoint)
            except DomainError as error:
                return StepDecision(kind="wait_user", reason=error.code,
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}))
            if decision is not None:
                return decision
        if checkpoint.pending_call_ids:
            from flowmate.runtime.recovery import mcp_query_degraded
            message, calls = self._calls(ctx, checkpoint)
            try:
                with self.store.transaction(write=False) as tx:
                    check_scopes(tx, message.source_dependencies)
                    degraded = mcp_query_degraded(tx, run.id)
            except DomainError:
                return StepDecision(kind="wait_user", reason="context_authorization_required",
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}))
            intents = []
            for call in calls:
                version = task.binding.config.catalog.tools.get(call.name)
                skipped = degraded and call.name in task.binding.config.catalog.mcp_tools
                tool = self.catalog.get(call.name, version) if version is not None and not skipped else None
                error, details = None, None
                if skipped:
                    error = "mcp_query_skipped"
                elif tool is None or not tool.spec.model_visible:
                    error = "tool_unavailable"
                    with self.store.transaction(write=False) as tx:
                        activity = load(tx, ActivitySnapshot, message.activity_id)
                    details = {"tool": call.name, "available_tools": list(wire_names(
                        tool["name"] for tool in activity.intent.arguments["tools"]).values())}
                else:
                    try:
                        args = call.arguments
                        if isinstance(args, str):
                            try:
                                args = strict_json(args)
                            except (ValueError, TypeError):
                                raise ToolArgumentsError([{"schema_path": [], "rule": "json", "expected": "object"}]) from None
                        args = (await tool.prepare_arguments(ctx, args)
                            if tool.prepare_arguments is not None else tool.validate_input(args))
                    except ToolArgumentsError as failure:
                        error = failure.code
                        details = {"tool": call.name, "issues": failure.issues}
                    except DomainError as failure:
                        error = failure.code
                        details = {"tool": call.name, "reason": failure.safe_message}
                if error:
                    if intents:
                        break
                    rejection = ModelMessage(role="tool", parts=[ToolResultPart(call_id=call.call_id, origin_message_id=message.id,
                        error=error, result=details)],
                        source_dependencies=content_dependencies(checkpoint, message.source_dependencies))
                    return StepDecision(kind="continue", messages=[rejection], checkpoint=checkpoint.model_copy(
                        update={"pending_call_ids": [id for id in checkpoint.pending_call_ids if id != call.call_id],
                                "phase": "dispatch_tools" if len(checkpoint.pending_call_ids) > 1 else "ready_model",
                                "message_boundary": checkpoint.message_boundary + 1}))
                call = call.model_copy(update={"arguments": args})
                if call.name == "memory.remember":
                    if intents:
                        break
                    from flowmate.memory import intent
                    with self.store.transaction(write=False) as tx:
                        review = intent.reviewed(tx, ctx, message.id, call.call_id)
                    if review is None:
                        try:
                            return await intent.prepare(self.context.memory, self.model, ctx,
                                call, message, task.binding.config.model_profile)
                        except DomainError as failure:
                            rejection = ModelMessage(role="tool", parts=[ToolResultPart(call_id=call.call_id,
                                origin_message_id=message.id, error=failure.code,
                                result={"reason": failure.safe_message})], source_dependencies=ctx.scope_dependencies)
                            return StepDecision(kind="continue", messages=[rejection], checkpoint=checkpoint.model_copy(
                                update={"pending_call_ids": [id for id in checkpoint.pending_call_ids if id != call.call_id],
                                    "phase": "dispatch_tools" if len(checkpoint.pending_call_ids) > 1 else "ready_model",
                                    "message_boundary": checkpoint.message_boundary + 1}))
                if call.name in {"task.submit", "task.status", "task.result", "task.await", "task.cancel"}:
                    if intents:
                        break
                    return StepDecision(kind="task_control", control_call=call,
                        control_origin_message_id=message.id,
                        control_dependencies=content_dependencies(checkpoint, message.source_dependencies,
                            delegate=call.name == "task.submit"))
                if call.name in {"user.ask", "run.finish", "agent.finish"}:
                    if intents:
                        break
                    return self._control(ctx, checkpoint, message, call, run)
                parallel = tool.spec.retry_class == "read_only" and not tool.spec.requires_approval
                if intents and not parallel:
                    break
                invocation = ToolInvocation(call_id=call.call_id, name=call.name, version=version,
                                            arguments=args)
                # 请求来源仅由可信Agent入口构造，不接受模型自报origin/dependencies。
                intents.append(ActivityIntent(kind="tool", origin="agent", operation=call.name,
                    arguments=invocation.model_dump(mode="json"),
                    dependencies=content_dependencies(checkpoint, message.source_dependencies)))
                if not parallel:
                    break
            return StepDecision(kind="activities", intents=intents,
                checkpoint=checkpoint.model_copy(update={"phase": "waiting_tools"}))
        if checkpoint.phase == "preparing_output" and set(steering) <= set(checkpoint.consumed_steering_ids):
            output = checkpoint.output
            if output is None or not (output.summary.strip() or output.artifact_ids) or (
                    output.unresolved and not isinstance(output, AgentResult)):
                return StepDecision(kind="fail", reason="invalid_output")
            if isinstance(output, AgentResult) and output.status == "failed":
                return StepDecision(kind="fail", reason="agent_failed")
            return StepDecision(kind="complete", output=output)
        finalizing = checkpoint.phase == "preparing_structured_output"
        without_tools = task.binding.config.model_profile.capabilities.tools is False
        if without_tools and not finalizing and (task.binding.agent_work is not None
                or task.binding.sources.skill_versions or run.kind == "maintenance"):
            return StepDecision(kind="wait_user", reason="unsupported_capability",
                checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}))
        interactive_root = run.kind == "user" and task.id == run.root_task_id
        memory_budget_low = False
        if interactive_root and "memory.remember" in task.binding.config.catalog.tools:
            with self.store.transaction(write=False) as tx:
                memory_budget_low = BudgetService.model_requests_left(tx, run) < 2
        tools = []
        if not finalizing and not without_tools:
            from flowmate.runtime.recovery import mcp_query_degraded
            with self.store.transaction(write=False) as tx:
                degraded = mcp_query_degraded(tx, run.id)
            for name, version in task.binding.config.catalog.tools.items():
                if degraded and name in task.binding.config.catalog.mcp_tools:
                    continue
                spec = self.catalog.get(name, version).spec
                if (model_tool_visible(spec, maintenance=run.kind == "maintenance",
                                       interactive_root=interactive_root)
                        and (not memory_budget_low or name not in {"memory.remember", "memory.propose"})):
                    tools.append(spec)
        tools = [await self.catalog.get(tool.name, tool.version).model_spec(ctx, tool)
            if self.catalog.get(tool.name, tool.version).model_spec is not None else tool
            for tool in tools]
        try:
            built = await self.context.build(ctx, checkpoint, task.binding.config.model_profile, tools)
        except DomainError as error:
            if error.code in {"context_limit", "context_authorization_required", "context_incomplete", "outside_run_scope",
                    "blocked_incompatible", "private_state_missing", "private_state_invalid", "private_state_too_large",
                    "private_state_unavailable", "unsupported_capability", "vision_model_required"}:
                return StepDecision(kind="wait_user", reason=error.code,
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user",
                        "context_manifest": {**checkpoint.context_manifest,
                            "compaction_state": "blocked", "compaction_reason": error.code}}))
            raise
        if isinstance(built, CompactionPlan):
            return StepDecision(kind="activity", intent=self.compaction.prepare(ctx, built),
                checkpoint=checkpoint.model_copy(update={"phase": "waiting_compaction",
                    "context_manifest": {**checkpoint.context_manifest,
                        "compaction": built.model_dump(mode="json"),
                        "compaction_state": "running", "compaction_reason": None},
                    "output": None, "output_dependencies": []}))
        manifest = {**built.manifest.model_dump(mode="json"), "model_message_boundary": checkpoint.message_boundary}
        if "child_failure_feedback" in checkpoint.context_manifest:
            manifest["child_failure_feedback"] = checkpoint.context_manifest["child_failure_feedback"]
        consume = list(dict.fromkeys([*checkpoint.consumed_steering_ids, *built.manifest.steering_ids]))
        new_checkpoint = checkpoint.model_copy(update={
            "phase": "waiting_structured_output" if finalizing else "waiting_model", "context_manifest": manifest,
            "consumed_steering_ids": consume,
            "message_boundary": checkpoint.message_boundary + len(built.manifest.steering_ids),
            "output": checkpoint.output if finalizing else None,
            "output_dependencies": checkpoint.output_dependencies if finalizing else []})
        return StepDecision(kind="activity", checkpoint=new_checkpoint, intent=ActivityIntent(kind="model",
            operation="model.finalize_output" if finalizing else "model.generate",
            arguments={"messages": [message.model_dump(mode="json") for message in built.messages],
                "instructions": built.instructions, "tools": [tool.model_dump(mode="json") for tool in tools],
                  "max_output_tokens": task.binding.config.model_profile.max_output_tokens,
                "projection_digest": built.projection_digest, "output_schema": built.output_schema},
            dependencies=built.manifest.source_dependencies))

    def propose_receipt(self, ctx, checkpoint, outcome):
        if isinstance(outcome, ModelOutcome):
            if outcome.error or outcome.response is None:
                pause = outcome.error in {"context_limit", "grant_required", "scope_revoked", "source_version_conflict",
                    "context_authorization_required",
                    "blocked_incompatible", "private_state_missing", "private_state_invalid", "private_state_too_large",
                    "private_state_unavailable", "projection_changed", "unsupported_capability", "vision_model_required"}
                return ReceiptCommit(checkpoint=checkpoint.model_copy(update={"phase": "waiting_user" if pause else "done"}),
                    next_decision=StepDecision(kind="wait_user" if pause else "fail", reason=outcome.error or "invalid_output"))
            message = outcome.response
            calls = [part for part in message.parts if isinstance(part, ToolCallPart)]
            if calls:
                with self.store.transaction(write=False) as tx:
                    profile = load(tx, TaskSnapshot, ctx.task_id).binding.config.model_profile
                if profile.capabilities.tools is False:
                    return ReceiptCommit(checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}),
                        next_decision=StepDecision(kind="wait_user", reason="unsupported_capability"))
            try:
                TypeAdapter(list[CallId]).validate_python([call.call_id for call in calls])
            except ValidationError:
                return ReceiptCommit(checkpoint=checkpoint, next_decision=StepDecision(kind="fail", reason="invalid_response"))
            if len({call.call_id for call in calls}) != len(calls):
                return ReceiptCommit(checkpoint=checkpoint, next_decision=StepDecision(kind="fail", reason="invalid_response"))
            if checkpoint.phase == "waiting_structured_output":
                from jsonschema.exceptions import ValidationError as SchemaValidationError
                from referencing.exceptions import Unresolvable
                with self.store.transaction(write=False) as tx:
                    work = load(tx, TaskSnapshot, ctx.task_id).binding.agent_work
                try:
                    if calls:
                        raise ValueError("最终结构化生成不能调用工具")
                    value = strict_json("".join(part.text for part in message.parts if isinstance(part, TextPart)))
                    agent_output_validator(work.output_schema).validate(value)
                except (ValueError, TypeError, SchemaValidationError, Unresolvable):
                    return ReceiptCommit(checkpoint=checkpoint.model_copy(update={"phase": "done"}),
                        next_decision=StepDecision(kind="fail", reason="invalid_output"))
                return ReceiptCommit(messages=[message],
                    private_states=[outcome.private_state] if outcome.private_state else [],
                    checkpoint=checkpoint.model_copy(update={"phase": "preparing_output",
                        "message_boundary": checkpoint.message_boundary + 1,
                        "output": checkpoint.output.model_copy(update={"structured_result": value}),
                        "output_dependencies": message.source_dependencies,
                        "private_refs": [*checkpoint.private_refs, *([message.private_ref] if message.private_ref else [])]}))
            output = None if calls else RunOutput(summary="".join(part.text for part in message.parts if isinstance(part, TextPart)))
            member = False
            if not calls:
                with self.store.transaction(write=False) as tx:
                    member = load(tx, TaskSnapshot, ctx.task_id).binding.agent_work is not None
                if member:
                    output = None
            return ReceiptCommit(messages=[message], private_states=[outcome.private_state] if outcome.private_state else [],
                checkpoint=checkpoint.model_copy(update={"phase": "dispatch_tools" if calls else
                    "ready_model" if member else "preparing_output",
                    "message_boundary": checkpoint.message_boundary + 1,
                    "pending_call_ids": [call.call_id for call in calls], "output": output,
                    "output_dependencies": message.source_dependencies,
                    "private_refs": [*checkpoint.private_refs, *([message.private_ref] if message.private_ref else [])]}))
        proposal = self.tools.propose_receipt(ctx, checkpoint, outcome)
        if outcome.call_id == "memory.merge" and self.maintenance is not None:
            with self.store.transaction(write=False) as tx:
                internal = load(tx, RunSnapshot, ctx.run_id).kind == "maintenance"
            if internal:
                error = outcome.error
                return proposal.model_copy(update={"checkpoint": proposal.checkpoint.model_copy(update={
                    "phase": "waiting_user" if error else "preparing_output",
                    "output": None if error else RunOutput(summary="已完成来源校验并提交待审记忆"),
                    "output_dependencies": outcome.dependencies}),
                    "next_decision": StepDecision(kind="wait_user", reason=error) if error else StepDecision(kind="continue")})
        if outcome.task_kind == "agent":
            origin, _ = self._calls(ctx, checkpoint)
            proposal = proposal.model_copy(update={"messages": [message.model_copy(update={"parts": [
                part.model_copy(update={"origin_message_id": origin.id}) if isinstance(part, ToolResultPart) else part
                for part in message.parts]}) for message in proposal.messages]})
        pending = proposal.checkpoint.pending_call_ids
        return proposal.model_copy(update={"checkpoint": proposal.checkpoint.model_copy(update={
            "phase": "dispatch_tools" if pending else "ready_model"})})

    async def drive_model(self, ctx, activity, cancel, before_send):
        from flowmate.tools.catalog import ToolSpec
        with self.store.transaction(write=False) as tx:
            task = load(tx, TaskSnapshot, ctx.task_id)
            checkpoint = load(tx, Checkpoint, ctx.task_id)
            compaction_plan = (CompactionPlan.model_validate_json(json.dumps(checkpoint.context_manifest["compaction"]))
                if checkpoint.phase == "waiting_compaction" else None)
            if compaction_plan is not None:
                if checkpoint.pending_activity_ids != [activity.id] or self.compaction._intent(compaction_plan) != activity.intent:
                    raise DomainError("compaction_binding", "待发送模型活动与固定压缩请求不一致")
                self.compaction._validate_plan_tx(tx, ctx, checkpoint, compaction_plan, ready=False)
        args = activity.intent.arguments
        request = ModelRequest(profile=task.binding.config.model_profile, attempt_id=activity.attempt_id,
            messages=[ModelMessage.model_validate(value) for value in args["messages"]],
            instructions=args["instructions"], tools=[ToolSpec.model_validate(value) for value in args["tools"]],
            max_output_tokens=args["max_output_tokens"], projection_digest=args["projection_digest"],
            output_schema=args.get("output_schema"))
        outcome = None
        index = 0
        async for event in self.model.stream(ctx, request, cancel, before_send=before_send):
            callback = self.emit_delta if event.kind == "text_delta" else (
                self.emit_reasoning_delta if event.kind == "reasoning_delta" else None)
            if callback is not None and compaction_plan is None and activity.intent.operation != "memory.review":
                callback(ctx, index, event.delta)
                index += 1
            if event.kind == "terminal":
                if outcome is not None:
                    raise DomainError("model_protocol_invalid", "模型回执重复")
                outcome = event.outcome
        if outcome is None:
            raise DomainError("model_protocol_invalid", "模型缺少终态回执")
        if activity.intent.operation == "memory.review":
            return outcome.receipt, lambda checkpoint: ReceiptCommit(checkpoint=checkpoint,
                next_decision=StepDecision(kind="continue"))
        if compaction_plan is not None:
            staged = summary = None
            error = outcome.error
            if error is None and outcome.response is not None:
                text = "".join(part.text for part in outcome.response.parts if isinstance(part, TextPart))
                try:
                    staged = await asyncio.to_thread(self.artifacts.stage_text, ctx, text, "text/plain",
                        compaction_plan.dependencies)
                    summary = self.compaction.summary(compaction_plan, outcome.response, artifact_id=staged.ref.id)
                except DomainError as failure:
                    if failure.code not in {"invalid_compaction_summary", "scope_revoked", "scope_mismatch",
                            "grant_required", "context_authorization_required", "source_version_conflict", "outside_run_scope"}:
                        raise
                    error = failure.code
            else:
                error = error or "invalid_compaction_summary"

            def propose_compaction(latest):
                manifest = {key: value for key, value in latest.context_manifest.items() if key != "compaction"}
                if error:
                    return ReceiptCommit(checkpoint=latest.model_copy(update={"phase": "waiting_user",
                        "context_manifest": {**manifest, "compaction_state": "blocked", "compaction_reason": error}}),
                        next_decision=StepDecision(kind="wait_user", reason=error))
                return ReceiptCommit(checkpoint=latest.model_copy(update={"phase": "ready_model",
                    "private_refs": compaction_plan.retained_private_refs,
                    "context_manifest": {**manifest, "compaction_state": "committed", "compaction_reason": None}}),
                    staged_artifacts=[staged], artifact_refs=[staged.ref],
                    context_summary={"plan": compaction_plan.model_dump(mode="json"),
                        "summary": summary.model_dump(mode="json")})

            return outcome.receipt, propose_compaction
        return outcome.receipt, lambda latest: self.propose_receipt(ctx, latest, outcome)

    async def drive_tool(self, ctx, activity, cancel, before_send):
        return await self.tools.drive(ctx, activity, cancel, before_send, propose=self.propose_receipt,
                                      normalize=self._compact_result)

    async def _compact_result(self, ctx, outcome):
        artifacts = self.artifacts
        result = outcome.result
        max_bytes = artifacts.config.max_tool_context_bytes
        if tool_result_bytes(result) <= max_bytes:
            return outcome
        with self.store.transaction(write=False) as tx:
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
        operation = activity.intent.operation
        is_mcp = activity.mcp_source is not None
        if outcome.error and not (is_mcp or operation == "skills.run_script"):
            return outcome
        if operation == "artifacts.read":
            # 按原产物的偏移继续读取，并为模型留出上下文空间。
            return outcome.model_copy(update={"result": _bounded_text_slice(TextSlice.model_validate(result), max_bytes)})

        # 当前候选观察尚未提交：暂存先按派发前的版本授权，引用发布再绑定同事务观察版本。
        observed = {item.resource_id: item for item in outcome.source_observations}
        staging_epochs = {}
        with self.store.transaction(write=False) as tx:
            for id, observation in observed.items():
                current = self.policy.resource(ctx, id, tx=tx)
                staging_epochs[id] = (current.version if current.source_version == observation.source_version
                                      else observation.expected_version)
        staging_dependencies = [item.model_copy(update={"epoch": staging_epochs[item.scope_id]})
            if item.scope_id in staging_epochs else item for item in outcome.dependencies]
        staged_artifacts = list(outcome.staged_artifacts)

        preview, documents = tool_result_projection(operation, result, is_mcp=is_mcp)
        for field, (text, media_type) in documents.items():
            staged = await asyncio.to_thread(artifacts.stage_text, ctx, text, media_type, staging_dependencies)
            if observed:
                staged = staged.model_copy(update={"ref": staged.ref.model_copy(update={"dependencies": outcome.dependencies})})
            staged_artifacts.append(staged)
            preview[field] = staged.ref.id
        return outcome.model_copy(update={"result": preview, "staged_artifacts": staged_artifacts})


def _bounded_text_slice(result, max_bytes):
    page = result.model_dump(mode="json")
    low, high = 1, len(result.text)
    while low < high:
        size = (low + high + 1) // 2
        if tool_result_bytes({**page, "text": result.text[:size], "end": result.start + size}) <= max_bytes:
            low = size
        else:
            high = size - 1
    size = min(low, len(result.text))
    return {**page, "text": result.text[:size], "end": result.start + size}
