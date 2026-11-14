"""Agent一步一提交，外部工作结束后才生成纯回执提议。"""

import asyncio
import json

from flowmate.agents.checkpoint import ControlResult, answer_validator
from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivityIntent,
    Checkpoint,
    ModelMessage,
    Question,
    ReceiptCommit,
    RunOutput,
    RunSnapshot,
    StepDecision,
    TextPart,
    ToolCallPart,
    ToolResultPart,
)
from flowmate.models.contracts import ModelOutcome, ModelRequest
from flowmate.policy.contracts import ToolInvocation
from flowmate.runtime.transitions import check_scopes, load, utc_now


class AgentExecutor:
    def __init__(self, store, catalog, model, tools, context=None, *, policy, artifacts, clock=None,
                 emit_delta=None, emit_reasoning_delta=None):
        self.store = store
        self.catalog = catalog
        self.model = model
        self.tools = tools
        self.policy = policy
        self.artifacts = artifacts
        if context is None:
            from flowmate.context.builder import ContextBuilder
            context = ContextBuilder(store, policy, estimate=lambda ctx, request: self.model.estimate(ctx, request))
        self.context = context
        self.clock = clock or utc_now
        self.emit_delta = emit_delta
        self.emit_reasoning_delta = emit_reasoning_delta

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
            tool = self.catalog.get(call.name, run.config.catalog.tools[call.name])
            args = tool.validate_input(call.arguments)
            if call.name == "user.ask":
                answer_validator(args.answer_schema)
                question = Question(run_id=run.id, task_id=ctx.task_id, call_id=call.call_id,
                    message_id=message.id, question=args.question, answer_schema=args.answer_schema,
                    dependencies=message.source_dependencies)
                return StepDecision(kind="wait_user", reason="question", question=question,
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user", "wait_ids": [question.id]}))
            with self.store.transaction(write=False) as tx:
                check_scopes(tx, message.source_dependencies)
                if args.output.unresolved:
                    raise DomainError("invalid_output", "unresolved表示尚未满足的任务要求，非空时不能完成。"
                        "若用户要求保留业务待确认事项，请写入summary或Artifact；仅在任务要求均已满足时传空列表。"
                        "真正未完成的要求须继续处理，不能为了完成而清空。")
                if (remaining or not (args.output.summary.strip() or args.output.artifact_ids)
                        or tx.execute("SELECT 1 FROM activities WHERE task_id=? AND state IN "
                                      "('prepared','dispatched','uncertain')", (ctx.task_id,)).fetchone()):
                    raise DomainError("invalid_output", "完成要求尚未满足")
                self.artifacts.validate_output(tx, ctx, args.output.artifact_ids)
            # 完成提议先提交控制结果，再经安全边界复核新steering/持久义务。
            return StepDecision(kind="continue", messages=[result()], checkpoint=next_checkpoint.model_copy(
                update={"phase": "preparing_output", "output": args.output,
                        "output_dependencies": message.source_dependencies}))
        except (DomainError, KeyError) as error:
            code = error.code if isinstance(error, DomainError) else "tool_unavailable"
            reason = error.safe_message if code == "invalid_output" else None
            return StepDecision(kind="continue", messages=[result(code, reason)], checkpoint=next_checkpoint)

    async def step(self, ctx, checkpoint):
        with self.store.transaction(write=False) as tx:
            run = load(tx, RunSnapshot, ctx.run_id)
            current = load(tx, Checkpoint, ctx.task_id)
            if current != checkpoint:
                raise DomainError("version_conflict", "检查点已推进")
            steering = [ModelMessage.model_validate_json(row[0]).id for row in tx.execute(
                "SELECT document FROM messages WHERE task_id=? ORDER BY rowid", (ctx.task_id,))
                if ModelMessage.model_validate_json(row[0]).origin == "steering"]
        if checkpoint.pending_activity_ids:
            raise DomainError("activities_pending", "仍有未提交的活动")
        if checkpoint.pending_call_ids:
            message, calls = self._calls(ctx, checkpoint)
            try:
                with self.store.transaction(write=False) as tx:
                    check_scopes(tx, message.source_dependencies)
            except DomainError:
                return StepDecision(kind="wait_user", reason="context_authorization_required",
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}))
            first = calls[0]
            if first.name in {"task.submit", "task.status", "task.result", "task.await", "task.cancel"}:
                return StepDecision(kind="task_control", control_call=first,
                                    control_origin_message_id=message.id,
                                    control_dependencies=message.source_dependencies)
            if first.name in {"user.ask", "run.finish"}:
                return self._control(ctx, checkpoint, message, first, run)
            intents = []
            for call in calls:
                if call.name in {"user.ask", "run.finish", "task.submit", "task.status", "task.result", "task.await", "task.cancel"}:
                    break
                version = run.config.catalog.tools.get(call.name)
                if version is None:
                    # 未注册身份仍返回结构化拒绝，永不发起用户专属入口。
                    rejection = ModelMessage(role="tool", parts=[ToolResultPart(call_id=call.call_id, origin_message_id=message.id,
                        error="tool_unavailable")])
                    return StepDecision(kind="continue", messages=[rejection], checkpoint=checkpoint.model_copy(
                        update={"pending_call_ids": [id for id in checkpoint.pending_call_ids if id != call.call_id],
                                "message_boundary": checkpoint.message_boundary + 1}))
                tool = self.catalog.get(call.name, version)
                parallel = tool.spec.retry_class == "read_only" and not tool.spec.requires_approval
                if intents and not parallel:
                    break
                invocation = ToolInvocation(call_id=call.call_id, name=call.name, version=version,
                                            arguments=call.arguments)
                # 请求来源仅由可信Agent入口构造，不接受模型自报origin/dependencies。
                intents.append(ActivityIntent(kind="tool", origin="agent", operation=call.name,
                    arguments=invocation.model_dump(mode="json"), dependencies=message.source_dependencies))
                if not parallel:
                    break
            return StepDecision(kind="activities", intents=intents,
                checkpoint=checkpoint.model_copy(update={"phase": "waiting_tools"}))
        if checkpoint.phase == "preparing_output" and set(steering) <= set(checkpoint.consumed_steering_ids):
            output = checkpoint.output
            if output is None or not (output.summary.strip() or output.artifact_ids) or output.unresolved:
                return StepDecision(kind="fail", reason="invalid_output")
            return StepDecision(kind="complete", output=output)
        tools = [self.catalog.get(name, version).spec for name, version in run.config.catalog.tools.items()
                 if self.catalog.get(name, version).spec.model_visible]
        try:
            built = await self.context.build(ctx, checkpoint, run.config.model_profile, tools)
        except DomainError as error:
            if error.code in {"context_limit", "context_authorization_required", "context_incomplete", "outside_run_scope",
                    "blocked_incompatible", "private_state_missing", "private_state_invalid", "private_state_too_large",
                    "private_state_unavailable", "unsupported_capability"}:
                return StepDecision(kind="wait_user", reason=error.code,
                    checkpoint=checkpoint.model_copy(update={"phase": "waiting_user"}))
            raise
        manifest = built.manifest.model_dump(mode="json")
        consume = list(dict.fromkeys([*checkpoint.consumed_steering_ids, *built.manifest.steering_ids]))
        new_checkpoint = checkpoint.model_copy(update={"phase": "waiting_model", "context_manifest": manifest,
            "consumed_steering_ids": consume,
            "message_boundary": checkpoint.message_boundary + len(built.manifest.steering_ids),
            "output": None, "output_dependencies": []})
        return StepDecision(kind="activity", checkpoint=new_checkpoint, intent=ActivityIntent(kind="model",
            operation="model.generate", arguments={"messages": [message.model_dump(mode="json") for message in built.messages],
                "instructions": built.instructions, "tools": [tool.model_dump(mode="json") for tool in tools],
                "max_output_tokens": run.config.model_profile.max_output_tokens,
                "projection_digest": built.projection_digest},
            dependencies=built.manifest.source_dependencies))

    def propose_receipt(self, ctx, checkpoint, outcome):
        if isinstance(outcome, ModelOutcome):
            if outcome.error or outcome.response is None:
                pause = outcome.error in {"context_limit", "grant_required", "scope_revoked", "context_authorization_required",
                    "blocked_incompatible", "private_state_missing", "private_state_invalid", "private_state_too_large",
                    "private_state_unavailable", "projection_changed", "unsupported_capability"}
                return ReceiptCommit(checkpoint=checkpoint.model_copy(update={"phase": "waiting_user" if pause else "done"}),
                    next_decision=StepDecision(kind="wait_user" if pause else "fail", reason=outcome.error or "invalid_output"))
            message = outcome.response
            calls = [part for part in message.parts if isinstance(part, ToolCallPart)]
            if len({call.call_id for call in calls}) != len(calls) or any(not call.call_id for call in calls):
                return ReceiptCommit(checkpoint=checkpoint, next_decision=StepDecision(kind="fail", reason="invalid_response"))
            output = None if calls else RunOutput(summary="".join(part.text for part in message.parts if isinstance(part, TextPart)))
            return ReceiptCommit(messages=[message], private_states=[outcome.private_state] if outcome.private_state else [],
                checkpoint=checkpoint.model_copy(update={"phase": "dispatch_tools" if calls else "preparing_output",
                    "message_boundary": checkpoint.message_boundary + 1,
                    "pending_call_ids": [call.call_id for call in calls], "output": output,
                    "output_dependencies": message.source_dependencies,
                    "private_refs": [*checkpoint.private_refs, *([message.private_ref] if message.private_ref else [])]}))
        proposal = self.tools.propose_receipt(ctx, checkpoint, outcome)
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
            run = load(tx, RunSnapshot, ctx.run_id)
        args = activity.intent.arguments
        request = ModelRequest(profile=run.config.model_profile, attempt_id=activity.attempt_id,
            messages=[ModelMessage.model_validate(value) for value in args["messages"]],
            instructions=args["instructions"], tools=[ToolSpec.model_validate(value) for value in args["tools"]],
            max_output_tokens=args["max_output_tokens"], projection_digest=args["projection_digest"])
        outcome = None
        index = 0
        async for event in self.model.stream(ctx, request, cancel, before_send=before_send):
            callback = self.emit_delta if event.kind == "text_delta" else (
                self.emit_reasoning_delta if event.kind == "reasoning_delta" else None)
            if callback is not None:
                callback(ctx, index, event.delta)
                index += 1
            if event.kind == "terminal":
                if outcome is not None:
                    raise DomainError("model_protocol_invalid", "模型回执重复")
                outcome = event.outcome
        if outcome is None:
            raise DomainError("model_protocol_invalid", "模型缺少终态回执")
        return outcome.receipt, lambda latest: self.propose_receipt(ctx, latest, outcome)

    async def drive_tool(self, ctx, activity, cancel, before_send):
        return await self.tools.drive(ctx, activity, cancel, before_send, propose=self.propose_receipt,
                                      normalize=self._compact_result)

    async def _compact_result(self, ctx, outcome):
        artifacts = self.artifacts
        text = json.dumps(outcome.result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if outcome.error or len(text.encode()) <= artifacts.config.max_tool_context_bytes:
            return outcome
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
        staged = await asyncio.to_thread(artifacts.stage_text, ctx, text, "text/plain", staging_dependencies)
        staged = staged.model_copy(update={"ref": staged.ref.model_copy(update={"dependencies": outcome.dependencies})})
        return outcome.model_copy(update={"result": {"artifact_id": staged.ref.id, "truncated": True,
            "preview": text[:1024], "total_chars": len(text)},
            "staged_artifacts": [*outcome.staged_artifacts, staged]})
