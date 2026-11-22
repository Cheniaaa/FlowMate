"""Pydantic AI Direct适配；运行状态与费用提交由Scheduler拥有。"""

import asyncio
import warnings
from contextlib import suppress
from dataclasses import replace
from functools import partial
from hashlib import sha256

import httpx2
from pydantic import ValidationError

from flowmate.contracts.base import DomainError, identifier
from flowmate.contracts.execution import (
    ActivityReceipt,
    ActivitySnapshot,
    ExecutionContext,
    ModelMessage,
    ReasoningPart,
    RunSnapshot,
    TaskSnapshot,
    TextPart,
    ToolCallPart,
    ToolResultPart,
    Usage,
)
from flowmate.host.diagnostics import make_diagnostic, write_diagnostic
from flowmate.host.protocol import ModelSecretBinding
from flowmate.models.contracts import ModelEvent, ModelOutcome, ModelRequest, ProjectionEstimate
from flowmate.models.metadata import official_provider_id
from flowmate.models.pricing import calculate_units
from flowmate.models.tool_names import wire_names
from flowmate.models.wire import GuardTransport, WireEvidence, strict_json
from flowmate.runtime.transitions import check_dispatch, context_for, load, utc_now
from flowmate.tools.catalog import ToolCatalog


def _supports_requested_thinking(profile):
    source = profile.metadata_sources.get("capabilities.thinking")
    return profile.capabilities.thinking is True and (
        source is None or source.kind != "catalog" or official_provider_id(profile) is not None)


def _classify(error):
    from pydantic_ai.exceptions import (
        ModelConnectionError,
        ModelHTTPError,
        ModelTimeoutError,
        UserError,
    )

    cause, seen = error, set()
    while cause is not None and id(cause) not in seen:
        if isinstance(cause, DomainError):
            return cause.code
        seen.add(id(cause))
        cause = cause.__cause__
    if isinstance(error, (ModelTimeoutError, TimeoutError, httpx2.TimeoutException)):
        return "model_timeout"
    if isinstance(error, (ModelConnectionError, httpx2.TransportError)):
        return "model_connection_failed"
    status = error.status_code if isinstance(error, ModelHTTPError) else None
    if status == 401:
        return "model_authentication_failed"
    if status == 403:
        return "model_permission_denied"
    if status == 429:
        return "model_rate_limited"
    if status is not None:
        return "model_provider_error"
    if isinstance(error, (ValueError, ValidationError)):
        return "invalid_response"
    if isinstance(error, UserError):
        return "unsupported_capability"
    return "model_request_failed"


class ModelGateway:
    def __init__(self, policy, secrets, *, private_state=None, transport=None,
                 clock=None, catalog=None, artifacts=None):
        self.policy = policy
        self.secrets = secrets
        from flowmate.models.private_state import PrivateStateCodec
        self.private_state = private_state or PrivateStateCodec(policy.store, secrets, policy)
        self.transport = transport
        self.clock = clock or utc_now
        self.catalog = catalog or ToolCatalog()
        self.artifacts = artifacts

    def _check(self, ctx, request, dependencies, cancel, *, initial=False):
        if cancel.is_set():
            raise DomainError("cancelled", "模型请求已取消")
        with self.policy.store.transaction(write=False) as tx:
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            run = load(tx, RunSnapshot, ctx.run_id)
            task = load(tx, TaskSnapshot, ctx.task_id)
            if (activity.run_id != run.id or activity.task_id != task.id
                    or activity.attempt_id != request.attempt_id or activity.intent.kind != "model"
                    or task.binding.config.model_profile != request.profile):
                raise DomainError("model_binding_mismatch", "模型请求与运行快照不一致")
            if initial and activity.state != "prepared":
                raise DomainError("already_dispatched", "模型活动不能重复发送")
            check_dispatch(tx, run, task, self.clock())
            for message in request.messages:
                origin = tx.execute("SELECT run_id,task_id FROM messages WHERE id=?", (message.id,)).fetchone()
                self.policy.check_run_sources(tx, ctx, message.source_dependencies,
                    source_run_id=origin[0] if origin is not None else ctx.run_id,
                    source_task_id=origin[1] if origin is not None else ctx.task_id)
            self.policy.check_run_sources(tx, ctx, dependencies)
            decision = self.policy.check_tx(tx, ctx, dependencies, "model_send", request.profile.endpoint)
            if not decision.allowed:
                raise DomainError(decision.reason or "model_send_denied", "模型输入缺少有效外发授权",
                                  related_ids=tuple(decision.missing_grants))
            return decision.dependencies, run.deadline_at

    async def _project(self, ctx, request):
        from jsonschema import Draft202012Validator
        from jsonschema.exceptions import SchemaError
        from pydantic_ai.models import ModelRequestParameters
        from pydantic_ai.output import OutputObjectDefinition
        from pydantic_ai.profiles.anthropic import anthropic_model_profile
        from pydantic_ai.tools import ToolDefinition

        from flowmate.models.endpoints import resolve_model_endpoint
        from flowmate.models.projection import RequestProjection

        output_object = None
        if request.output_schema is not None:
            if request.profile.capabilities.structured_output is False:
                raise DomainError("unsupported_capability", "当前模型不支持原生结构化交付")
            try:
                Draft202012Validator.check_schema(request.output_schema)
            except SchemaError:
                raise DomainError("output_schema_invalid", "结构化交付Schema无效") from None
            output_object = OutputObjectDefinition(json_schema=request.output_schema, name="flowmate_output")
        settings = {"max_tokens": request.max_output_tokens, "max_retries": 0,
                    "timeout": request.profile.request_timeout_seconds}
        protocol = resolve_model_endpoint(request.profile.protocol, request.profile.endpoint).protocol
        provider = official_provider_id(request.profile)
        if provider == "openai":
            settings["openai_prompt_cache_key"] = sha256(f"flowmate:{ctx.session_id}".encode()).hexdigest()
        elif provider == "anthropic":
            # 仅为固定工具定义和系统提示标记服务端断点，动态消息继续按当次授权发送。
            settings["anthropic_cache_tool_definitions"] = True
            settings["anthropic_cache_instructions"] = True
        effort = request.profile.reasoning_effort
        supports_thinking = _supports_requested_thinking(request.profile)
        if effort is not None:
            if protocol == "anthropic":
                settings["anthropic_thinking"] = {"type": "adaptive"}
                settings["anthropic_effort"] = effort
            else:
                settings["openai_reasoning_effort"] = effort
        elif supports_thinking:
            if protocol == "anthropic" and not anthropic_model_profile(
                    request.profile.canonical_model_id or request.profile.model_id).get("anthropic_supports_adaptive_thinking", False):
                # 旧Messages型号的思考预算计入输出限制；不能让SDK默认10000突破本次预留。
                if request.max_output_tokens > 1024:
                    settings["anthropic_thinking"] = {"type": "enabled",
                        "budget_tokens": min(10000, request.max_output_tokens - 1)}
            else:
                settings["thinking"] = True
        if protocol == "openai_responses":
            settings["openai_store"] = False
            if supports_thinking:
                settings["openai_reasoning_summary"] = "auto"
        names = wire_names([*[tool.name for tool in request.tools],
            *(part.name for message in request.messages for part in message.parts if isinstance(part, ToolCallPart))])
        projection = RequestProjection(messages=await self._messages(ctx, request, names),
            parameters=ModelRequestParameters(function_tools=[ToolDefinition(name=names[tool.name],
                description=tool.description or tool.name, parameters_json_schema=tool.input_schema) for tool in request.tools],
                allow_text_output=True, output_mode="native" if output_object else "text",
                output_object=output_object), settings=settings)
        await projection.serialize(request.profile, partial(self._sdk, messages=projection.messages))
        return projection

    async def estimate(self, ctx: ExecutionContext, request: ModelRequest) -> ProjectionEstimate:
        with self.policy.store.transaction(write=False) as tx:
            if ctx.model_copy(update={"activity_id": None}) != context_for(tx, ctx.task_id):
                raise DomainError("owner_mismatch", "估算不属于当前真实任务")
            if request.profile != load(tx, TaskSnapshot, ctx.task_id).binding.config.model_profile:
                raise DomainError("model_binding_mismatch", "估算必须使用Run固定配置")
            dependencies = [*ctx.scope_dependencies,
                *(dependency for message in request.messages for dependency in message.source_dependencies)]
            for message in request.messages:
                origin = tx.execute("SELECT run_id,task_id FROM messages WHERE id=?", (message.id,)).fetchone()
                self.policy.check_run_sources(tx, ctx, message.source_dependencies,
                    source_run_id=origin[0] if origin is not None else ctx.run_id,
                    source_task_id=origin[1] if origin is not None else ctx.task_id)
            decision = self.policy.check_tx(tx, ctx, dependencies, "model_send", request.profile.endpoint)
            if not decision.allowed:
                raise DomainError(decision.reason or "grant_required", "估算输入缺少有效外发授权")
        return (await self._project(ctx, request)).estimate()

    async def _messages(self, ctx, request, names):
        from pydantic_ai.messages import (
            ModelRequest as SDKRequest,
        )
        from pydantic_ai.messages import (
            ModelResponse as SDKResponse,
        )
        from pydantic_ai.messages import (
            SystemPromptPart,
            ToolReturnPart,
            UserPromptPart,
        )
        from pydantic_ai.messages import (
            TextPart as SDKText,
        )
        from pydantic_ai.messages import (
            ToolCallPart as SDKCall,
        )

        from flowmate.models.media import tool_content

        messages, pending, tool_returns = [], {}, []
        if request.instructions:
            messages.append(SDKRequest(parts=[SystemPromptPart(request.instructions)]))
        for message in request.messages:
            if message.role == "assistant":
                for part in message.parts:
                    if isinstance(part, ToolCallPart):
                        if part.call_id in pending:
                            raise DomainError("invalid_messages", "模型工具调用身份重复")
                        pending[part.call_id] = part.name
                if message.private_ref:
                    restored = await self.private_state.decode(ctx, request.profile, message)
                    messages.append(replace(restored, parts=[replace(part, tool_name=names[part.tool_name])
                        if isinstance(part, SDKCall) else part for part in restored.parts]))
                else:
                    if any(isinstance(part, ReasoningPart) for part in message.parts):
                        raise DomainError("private_state_missing", "reasoning续接需要原始SDK私有记录，不能降级成普通文本")
                    parts = [SDKText(part.text) if isinstance(part, TextPart) else
                             SDKCall(names[part.name], part.arguments, part.call_id) for part in message.parts
                             if isinstance(part, (TextPart, ToolCallPart))]
                    if len(parts) != len(message.parts):
                        raise DomainError("invalid_messages", "assistant消息包含非法part")
                    messages.append(SDKResponse(parts=parts))
            elif message.role == "user":
                if any(not isinstance(part, TextPart) for part in message.parts):
                    raise DomainError("invalid_messages", "用户输入只能包含文本")
                messages.append(SDKRequest(parts=[UserPromptPart(part.text) for part in message.parts]))
            else:
                parts = []
                for part in message.parts:
                    if not isinstance(part, ToolResultPart) or part.call_id not in pending:
                        raise DomainError("invalid_messages", "工具结果缺少对应调用")
                    operation = pending.pop(part.call_id)
                    content = tool_content(ctx, part, request.profile, self.artifacts,
                        activity_id=message.activity_id, operation=operation)
                    parts.append(ToolReturnPart(tool_name=names[operation],
                        tool_call_id=part.call_id, content=content,
                        outcome="failed" if part.error else "success"))
                tool_returns.extend(parts)
                if not pending:
                    messages.append(SDKRequest(parts=tool_returns))
                    tool_returns = []
        if pending or not request.messages:
            raise DomainError("invalid_messages", "模型上下文包含未解决工具调用")
        return messages

    @staticmethod
    def _sdk(profile, key, client, headers, *, messages=()):
        from anthropic import AsyncAnthropic
        from openai import AsyncOpenAI
        from pydantic_ai.messages import ModelResponse, ThinkingPart
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
        from pydantic_ai.profiles.anthropic import AnthropicModelProfile, anthropic_model_profile
        from pydantic_ai.profiles.openai import OpenAIModelProfile, openai_model_profile
        from pydantic_ai.providers.anthropic import AnthropicProvider
        from pydantic_ai.providers.openai import OpenAIProvider
        from pydantic_ai.providers.openai_compatible import OpenAICompatibleProvider

        from flowmate.models.endpoints import resolve_model_endpoint

        class ProfileHeaders:
            def __init__(self, **kwargs):
                super().__init__(**kwargs)
                self._custom_headers = {}
        class ProfileOpenAI(ProfileHeaders, AsyncOpenAI):
            pass
        class ProfileAnthropic(ProfileHeaders, AsyncAnthropic):
            pass
        endpoint = resolve_model_endpoint(profile.protocol, profile.endpoint)
        profile_name = profile.canonical_model_id or profile.model_id
        if endpoint.protocol in {"openai_compatible", "openai_responses"}:
            sdk = ProfileOpenAI(api_key=key, base_url=endpoint.base_url, admin_api_key="", organization="",
                project="", webhook_secret="", max_retries=0, http_client=client)
            official = official_provider_id(profile) == "openai"
            supports_thinking = _supports_requested_thinking(profile)
            # 兼容端点的同名模型不能继承 OpenAI 专属推理字段。
            trusted_name = official or (profile.canonical_model_id is not None and supports_thinking)
            behavior = openai_model_profile(
                profile_name if trusted_name and profile.capabilities.thinking is not False else "")
            replaying_encrypted = endpoint.protocol == "openai_responses" and any(
                isinstance(part, ThinkingPart) and part.signature
                for message in messages if isinstance(message, ModelResponse) for part in message.parts)
            behavior = OpenAIModelProfile(**(behavior | {
                "supports_tools": profile.capabilities.tools is not False,
                "supports_thinking": supports_thinking or behavior.get("supports_thinking", False),
                "supports_json_schema_output": profile.capabilities.structured_output is not False,
                "openai_supports_encrypted_reasoning_content": profile.capabilities.thinking is not False and (
                    supports_thinking or replaying_encrypted or behavior.get("openai_supports_encrypted_reasoning_content", False)),
                "openai_chat_streaming_requires_finish_reason": True,
                "openai_chat_supports_max_completion_tokens": profile.openai_max_tokens_field != "max_tokens"}))
            provider = OpenAIProvider(openai_client=sdk) if official else (
                OpenAICompatibleProvider(f"flowmate-connection-{profile.connection_id}", openai_client=sdk,
                    profile=lambda _: behavior))
            adapter = OpenAIResponsesModel if endpoint.protocol == "openai_responses" else OpenAIChatModel
            model = adapter(profile.model_id, provider=provider, profile=behavior)
        else:
            sdk = ProfileAnthropic(api_key=key, base_url=endpoint.base_url, webhook_key="", open_telemetry=False,
                                    max_retries=0, http_client=client)
            model = AnthropicModel(profile.model_id, provider=AnthropicProvider(anthropic_client=sdk),
                profile=AnthropicModelProfile(**(anthropic_model_profile(profile_name) | {
                    "supports_tools": profile.capabilities.tools is not False,
                    "supports_thinking": profile.capabilities.thinking is not False,
                    "supports_json_schema_output": profile.capabilities.structured_output is not False})))
        # 认证与版本头取锁定SDK公开结果；保留GuardTransport既有出站白名单，不手写认证格式。
        headers.update({name: value for name, value in (sdk.default_headers | sdk.auth_headers).items()
            if name.lower() in {"accept", "content-type", "authorization", "anthropic-version"}})
        return model

    async def stream(self, ctx, request, cancel, *, before_send):
        from pydantic_ai import UsageExtractionFailedWarning
        from pydantic_ai.direct import model_request_stream
        from pydantic_ai.exceptions import ModelHTTPError
        from pydantic_ai.messages import (
            PartDeltaEvent,
            PartStartEvent,
            TextPartDelta,
            ThinkingPart,
            ThinkingPartDelta,
        )
        from pydantic_ai.messages import (
            TextPart as SDKText,
        )
        from pydantic_ai.messages import (
            ToolCallPart as SDKCall,
        )

        from flowmate.models.discovery import credential_identity
        from flowmate.models.endpoints import resolve_model_endpoint
        from flowmate.models.observations import ModelObservations
        from flowmate.models.projection import ProjectionTransport

        guard = client = watcher = None
        projection = credential_id = rejection = None
        evidence = WireEvidence(request.profile.protocol)
        confirmed = False
        usage = Usage()
        actual = None
        response = private = None
        error_code = None
        dependencies = [*ctx.scope_dependencies,
                        *(item for message in request.messages for item in message.source_dependencies)]
        provenance = dependencies
        requested_scopes = {item.scope_id for item in dependencies}
        outer = asyncio.current_task()
        try:
            dependencies, deadline = self._check(ctx, request, dependencies, cancel, initial=True)
            # 发送围栏包含Policy临时展开的资源；持久provenance仅记录实际输入与使用的grant。
            # 未观察正文的ResourceRef元信息不能虚构正文版本，首次读取后会建立真实hash epoch。
            with self.policy.store.transaction(write=False) as tx:
                provenance = [item for item in dependencies if item.scope_id in requested_scopes or tx.execute(
                    "SELECT 1 FROM grants WHERE id=?", (item.scope_id,)).fetchone()]
            if (not 0 < request.max_output_tokens <= request.profile.max_output_tokens
                    or request.tools and request.profile.capabilities.tools is False):
                raise DomainError("unsupported_capability", "模型配置不允许所请求输出或工具能力")
            if request.profile.secret_ref is None:
                raise DomainError("credential_missing", "模型凭据尚未配置")
            with self.policy.store.transaction(write=False) as tx:
                task = load(tx, TaskSnapshot, ctx.task_id)
            for tool in request.tools:
                bound = self.catalog.get(tool.name, tool.version)
                if (not tool.model_visible
                        or task.binding.config.catalog.tools.get(tool.name) != tool.version):
                    raise DomainError("tool_unavailable", "模型工具Schema不属于当前Run目录")
                expected = (await bound.model_spec(ctx, bound.spec)
                    if bound.model_spec is not None else bound.spec)
                if expected != tool:
                    raise DomainError("tool_unavailable", "模型工具Schema不属于当前Run目录")
            names = wire_names([*[tool.name for tool in request.tools],
                *(part.name for message in request.messages for part in message.parts if isinstance(part, ToolCallPart))])
            internal_names = {wire: internal for internal, wire in names.items()}
            projection = await self._project(ctx, request)
            if request.projection_digest is not None and projection.estimate().projection_digest != request.projection_digest:
                raise DomainError("projection_changed", "模型输入在准备后发生变化，请重新准备请求")
            key = (await self.secrets.resolve(ModelSecretBinding(connection_id=request.profile.connection_id,
                connection_version=request.profile.connection_version, protocol=request.profile.protocol,
                 endpoint=request.profile.endpoint,
                 secret_ref=request.profile.secret_ref))).decode("utf-8")
            credential_id = credential_identity(request.profile, key)
            headers = {}
            pricing = task.binding.config.model_pricing
            file_message_id = self.policy.session_file_message_id(ctx.run_id)
            session_file_ids = {id for message in request.messages if message.id == file_message_id
                for id in strict_json(message.parts[0].text)["available_session_files"]}

            def dispatch(dispatch_request):
                # 按实际输入重新展开授权闭包；未观察元信息不能冻结成旧正文epoch。
                # 显式正文依赖及grant epoch仍由Policy在原派发事务严格复核。
                def authorize(tx):
                    if session_file_ids:
                        run = load(tx, RunSnapshot, ctx.run_id)
                        task = load(tx, TaskSnapshot, ctx.task_id)
                        available = self.policy.available_session_files(tx, ctx, run, task, request.profile.endpoint)
                        if not session_file_ids.issubset(available):
                            raise DomainError("context_authorization_required", "会话文件续读授权或版本已失效")
                    decision = self.policy.check_tx(tx, ctx, provenance, "model_send", request.profile.endpoint)
                    if not decision.allowed:
                        raise DomainError(decision.reason or "model_send_denied", "模型输入缺少有效外发授权",
                                          related_ids=tuple(decision.missing_grants))
                return before_send(dispatch_request, authorize=authorize)
            guard = GuardTransport(self.transport or httpx2.AsyncHTTPTransport(retries=0),
                profile=request.profile, ctx=ctx, attempt_id=request.attempt_id,
                max_output_tokens=request.max_output_tokens, pricing=pricing, headers=headers,
                dependencies=provenance, before_send=dispatch,
                check=lambda: self._check(ctx, request, provenance, cancel), evidence=evidence)
            timeout = min(request.profile.request_timeout_seconds, (deadline - self.clock()).total_seconds())
            client = httpx2.AsyncClient(transport=ProjectionTransport(projection, guard,
                resolve_model_endpoint(request.profile.protocol, request.profile.endpoint)), timeout=timeout,
                follow_redirects=False, trust_env=False)
            model = self._sdk(request.profile, key, client, headers, messages=projection.messages)
            async def interrupt():
                await cancel.wait()
                outer.cancel()
            watcher = asyncio.create_task(interrupt())
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UsageExtractionFailedWarning)
                    async with asyncio.timeout(timeout):
                        async with model_request_stream(model, projection.messages, instrument=False,
                            model_settings=projection.settings,
                            model_request_parameters=projection.parameters) as streamed:
                            async for event in streamed:
                                try:
                                    self._check(ctx, request, provenance, cancel)
                                except DomainError:
                                    continue  # 不交付新内容；已在途仍读取确定费用回执。
                                if isinstance(event, PartStartEvent) and isinstance(event.part, SDKText):
                                    yield ModelEvent(kind="text_delta", delta=event.part.content)
                                elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                                    yield ModelEvent(kind="text_delta", delta=event.delta.content_delta)
                                elif (isinstance(event, PartStartEvent) and isinstance(event.part, ThinkingPart)
                                      and request.profile.capabilities.thinking is not False and event.part.content):
                                    yield ModelEvent(kind="reasoning_delta", delta=event.part.content)
                                elif (isinstance(event, PartDeltaEvent) and isinstance(event.delta, ThinkingPartDelta)
                                      and request.profile.capabilities.thinking is not False and event.delta.content_delta):
                                    yield ModelEvent(kind="reasoning_delta", delta=event.delta.content_delta)
                            sdk_response = streamed.get()
            finally:
                # 完整wire费用已确定，SDK解析或响应流清理失败也不能丢失；内容仍由外层失败处理拒绝。
                if evidence.terminal:
                    confirmed = True
                    usage = evidence.usage()
                    if usage.status == "known" and pricing is not None:
                        actual = calculate_units(pricing, {"input_tokens": usage.input_tokens,
                            "output_tokens": usage.output_tokens, "cache_read_tokens": usage.cached_input_tokens,
                            "cache_write_tokens": usage.cache_write_tokens,
                            "cache_write_1h_tokens": usage.cache_write_1h_tokens}, evidence.price_context)
            if not evidence.terminal:
                raise DomainError("invalid_response", "模型未返回完整协议回执")
            if sdk_response.finish_reason == "length":
                raise DomainError("output_limit", "模型输出达到限制")
            if sdk_response.finish_reason not in {"stop", "tool_call"} or sdk_response.state != "complete":
                raise DomainError("invalid_response", "模型响应不完整")
            self._check(ctx, request, provenance, cancel)
            evidence.check_call_ids([part.tool_call_id for part in sdk_response.parts if isinstance(part, SDKCall)])
            parts = []
            normalized_sdk_parts = []
            for part in sdk_response.parts:
                if isinstance(part, SDKText):
                    parts.append(TextPart(text=part.content))
                elif isinstance(part, SDKCall):
                    if part.tool_name not in internal_names and part.tool_name in names:
                        raise DomainError("invalid_response", "模型工具wire名称不能冒用内部工具身份")
                    internal_name = internal_names.get(part.tool_name, part.tool_name)
                    try:
                        args = strict_json(part.args) if isinstance(part.args, str) else part.args
                    except (ValueError, TypeError):
                        args = part.args
                    # 保留坏JSON/非object给Agent生成可配对错误；不执行，也不覆写SDK私有原文。
                    if not isinstance(args, dict):
                        args = part.args if isinstance(part.args, str) else ""
                    parts.append(ToolCallPart(name=internal_name, call_id=part.tool_call_id,
                                               arguments=args))
                    part = replace(part, tool_name=internal_name)
                elif isinstance(part, ThinkingPart) and request.profile.capabilities.thinking is not False:
                    if part.content:
                        parts.append(ReasoningPart(text=part.content))
                else:
                    raise DomainError("unsupported_capability", "模型返回未启用的私有能力")
                normalized_sdk_parts.append(part)
            sdk_response = replace(sdk_response, parts=normalized_sdk_parts)
            if (request.output_schema is not None and not request.tools
                    and any(isinstance(part, ToolCallPart) for part in parts)):
                raise DomainError("invalid_response", "最终结构化生成不能返回工具调用")
            if request.output_schema is not None and not any(isinstance(part, ToolCallPart) for part in parts):
                from jsonschema import Draft202012Validator
                from jsonschema.exceptions import ValidationError as SchemaValidationError
                from referencing import Registry
                from referencing.exceptions import Unresolvable
                try:
                    value = strict_json("".join(part.text for part in parts if isinstance(part, TextPart)))
                    Draft202012Validator(request.output_schema, registry=Registry()).validate(value)
                except (ValueError, TypeError, SchemaValidationError, Unresolvable):
                    raise DomainError("invalid_response", "模型原生结构化交付不满足Schema") from None
            required_private = self.private_state.requires_private(sdk_response)
            response = ModelMessage(role="assistant", activity_id=ctx.activity_id, parts=parts,
                source_dependencies=provenance, private_ref=identifier() if required_private else None)
            if required_private:
                private = await self.private_state.encode(ctx, request.profile, response, sdk_response)
            self._check(ctx, request, provenance, cancel)
        except asyncio.CancelledError:
            if not cancel.is_set():
                raise
            outer.uncancel()
            error_code = "cancelled"
            response = private = None
        except Exception as error:
            error_code = _classify(error)
            if (isinstance(error, ModelHTTPError) and evidence.response_complete
                    and evidence.response_status in {400, 422}):
                rejection = error.body
            # 流内错误也可能被SDK映射成401/403；只有真实完整HTTP拒绝能确认失败，费用仍可未知。
            if (isinstance(error, ModelHTTPError) and evidence.response_complete
                    and evidence.response_status in {401, 403}):
                confirmed = True
            if not isinstance(error, DomainError):
                write_diagnostic(make_diagnostic(error_code, error, request_id=ctx.activity_id))
            response = private = None
        finally:
            if watcher is not None:
                watcher.cancel()
                with suppress(asyncio.CancelledError):
                    await watcher
            if client is not None:
                try:
                    await client.aclose()
                except Exception as error:
                    write_diagnostic(make_diagnostic("model_cleanup_failed", error, request_id=ctx.activity_id))
                    error_code = error_code or "model_cleanup_failed"
                    response = private = None
        sent = guard is not None and guard.sent
        receipt = ActivityReceipt(activity_id=ctx.activity_id, attempt_id=request.attempt_id,
            confirmed=confirmed or not sent, result=response.model_dump(mode="json") if response else None,
            error=error_code, usage=usage, actual_units=actual if sent else 0,
            provider_request_id=evidence.request_id, source_dependencies=provenance)
        if sent:
            from flowmate.models.media_receipt import image_rejection
            receipt = image_rejection(receipt, request, projection.body, evidence, rejection)
            error_code = receipt.error
        if sent:
            with self.policy.store.transaction() as tx:
                ModelObservations.record(tx, request, receipt, projection_body=projection.body,
                    sent=sent, credential_identity=credential_id, response_status=evidence.response_status,
                    response_complete=evidence.response_complete, rejection=rejection,
                    wire_call_ids=list(evidence.call_ids.values()))
        yield ModelEvent(kind="terminal", outcome=ModelOutcome(response=response, receipt=receipt,
            error=error_code, private_ref=response.private_ref if response else None, private_state=private))
