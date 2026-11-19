"""SDK消息先由宿主保护，候选密文仅在回执事务写入私有表。"""

import base64
import hashlib
import json
from importlib import import_module
from importlib.metadata import PackageNotFoundError, version
from typing import TYPE_CHECKING, Literal

import httpx2
from pydantic import Field, JsonValue, ValidationError

from flowmate.contracts.base import Contract, DomainError, Id, Version
from flowmate.contracts.execution import (
    ActivitySnapshot,
    ExecutionContext,
    ModelMessage,
    ReasoningPart,
    RunSnapshot,
    ScopeDependency,
    TaskSnapshot,
    TextPart,
    ToolCallPart,
)
from flowmate.contracts.settings import ResolvedModelProfile
from flowmate.host.protocol import ProtectedValue
from flowmate.host.secrets import HostSecrets
from flowmate.policy.service import PolicyService
from flowmate.runtime.transitions import check_scopes, context_for, load

if TYPE_CHECKING:
    from pydantic_ai.messages import ModelResponse

SDK_VERSION = "2.65.0"
ADAPTER_IDS = {"openai_compatible": "pydantic-ai.openai-chat-completions",
               "anthropic": "pydantic-ai.anthropic-messages"}


class ReplayCompatibility(Contract):
    protocol: str
    endpoint: str
    model_id: str
    adapter_id: str
    adapter_version: str = "1"
    sdk_version: str = SDK_VERSION
    codec_version: int = 1

    @classmethod
    def from_profile(cls, profile: ResolvedModelProfile):
        return cls(protocol=profile.protocol, endpoint=str(httpx2.URL(profile.endpoint)).rstrip("/"),
            model_id=profile.model_id, adapter_id=ADAPTER_IDS[profile.protocol])


class _Metadata(Contract):
    id: Id
    codec_version: Literal[1] = 1
    adapter_id: str
    adapter_version: Literal["1"] = "1"
    sdk_version: Literal["2.65.0"] = SDK_VERSION
    protocol: Literal["openai_compatible", "anthropic"]
    model_profile_id: Id
    model_profile_version: Version
    connection_id: Id
    connection_version: Version
    model_id: str
    endpoint: str
    workspace_id: Id
    session_id: Id
    run_id: Id
    task_id: Id
    public_message_id: Id
    source_activity_id: Id
    source_dependencies: list[ScopeDependency]
    public_message_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class PrivateStateEnvelope(_Metadata):
    protected_blob: ProtectedValue = Field(repr=False)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def _message_hash(message):
    return hashlib.sha256(_canonical(message.model_dump(mode="json"))).hexdigest()


def _profile_identity(profile):
    return (profile.id, profile.version, profile.connection_id, profile.connection_version,
            profile.protocol, profile.model_id, profile.endpoint)


def _match_profile(metadata, profile):
    if (metadata.model_profile_id, metadata.model_profile_version, metadata.connection_id,
        metadata.connection_version, metadata.protocol,
        metadata.model_id, metadata.endpoint) != _profile_identity(profile):
        raise DomainError("blocked_incompatible", "私有续接的模型配置或目的地不一致")


def _sdk():
    """可选依赖缺失/变版必须成为恢复阻塞，不在模块导入时破坏非模型功能。"""
    try:
        if version("pydantic-ai-slim") != SDK_VERSION:
            raise DomainError("blocked_incompatible", "私有续接所需SDK版本不可用")
        module = import_module("pydantic_ai.messages")
        adapter = module.ModelMessagesTypeAdapter
        if not callable(adapter.dump_json) or not callable(adapter.validate_json):
            raise AttributeError
        return module
    except (ImportError, AttributeError, PackageNotFoundError):
        raise DomainError("blocked_incompatible", "私有续接所需SDK或消息codec不可用") from None


def _allow(decision):
    if not decision.allowed:
        raise DomainError(decision.reason or "grant_required", "私有续接的模型发送授权不可用")


def _match_message(metadata, message):
    if (message.role != "assistant" or message.private_ref != metadata.id
            or message.id != metadata.public_message_id
            or message.activity_id != metadata.source_activity_id
            or message.source_dependencies != metadata.source_dependencies
            or _message_hash(message) != metadata.public_message_hash):
        raise DomainError("private_state_invalid", "私有续接与公开消息身份或来源不一致")


def _match_response(sdk, response, message, profile):
    if not isinstance(response, sdk.ModelResponse):
        raise DomainError("blocked_incompatible", "私有续接不是受支持的SDK响应")
    parts = []
    include_reasoning = any(isinstance(part, ReasoningPart) for part in message.parts)
    for part in response.parts:
        if isinstance(part, sdk.ThinkingPart):
            if not profile.capabilities.thinking:
                raise DomainError("unsupported_capability", "当前模型配置未启用thinking")
            if include_reasoning and part.content:
                parts.append(ReasoningPart(text=part.content))
        elif isinstance(part, sdk.TextPart):
            parts.append(TextPart(text=part.content))
        elif isinstance(part, sdk.ToolCallPart):
            if not profile.capabilities.tools:
                raise DomainError("unsupported_capability", "当前模型配置未启用tools")
            try:
                parts.append(ToolCallPart(call_id=part.tool_call_id, name=part.tool_name,
                                          arguments=part.args_as_dict()))
            except (ValueError, TypeError, ValidationError):
                raise DomainError("private_state_invalid", "SDK工具调用不能匹配公开消息") from None
        else:
            # M1不把Responses、compaction或内置provider工具当成已支持能力。
            raise DomainError("blocked_incompatible", "私有续接包含未支持的响应part")
    def identity(part):
        if isinstance(part, TextPart):
            return ("text", part.text)
        if isinstance(part, ReasoningPart):
            return ("reasoning", part.text)
        if isinstance(part, ToolCallPart):
            return ("tool_call", part.call_id, part.name)
        return ("unsupported",)

    calls = [part.call_id for part in parts if isinstance(part, ToolCallPart)]
    # 工具目录可补默认值/规范化arguments；完整公开参数已由message hash绑定，
    # 此处只绑定公开part身份，不能因此覆写SDK原始arguments或私有provider字段。
    if ([identity(part) for part in parts] != [identity(part) for part in message.parts]
            or len(calls) != len(set(calls))):
        raise DomainError("private_state_invalid", "SDK响应的part顺序或工具配对不一致")


class PrivateStateCodec:
    def __init__(self, store, secrets: HostSecrets, policy: PolicyService, *, max_bytes=262144):
        if type(max_bytes) is not int or max_bytes <= 0:
            raise ValueError("max_bytes必须为正整数")
        self.store = store
        self.secrets = secrets
        self.policy = policy
        self.max_bytes = max_bytes

    @staticmethod
    def requires_private(response) -> bool:
        sdk = _sdk()
        # Chat/Messages的普通response计量/finish metadata不是回放输入；part私有扩展必须完整保存。
        return any(isinstance(part, sdk.ThinkingPart) or bool(part.provider_details) for part in response.parts)

    @staticmethod
    def _owner(tx, ctx, profile):
        actual = context_for(tx, ctx.task_id)
        if ctx.model_copy(update={"activity_id": None}) != actual:
            raise DomainError("owner_mismatch", "私有续接上下文不属于真实任务")
        task = load(tx, TaskSnapshot, ctx.task_id)
        if profile != task.binding.config.model_profile:
            raise DomainError("blocked_incompatible", "私有续接须使用当前Run固定模型配置")
        check_scopes(tx, ctx.scope_dependencies)
        if ctx.activity_id is not None:
            activity = load(tx, ActivitySnapshot, ctx.activity_id)
            if (activity.run_id, activity.task_id) != (ctx.run_id, ctx.task_id):
                raise DomainError("owner_mismatch", "私有续接活动不属于当前任务")

    @staticmethod
    def _origin(tx, ctx, metadata, profile, message, *, publishing=False):
        _match_message(metadata, message)
        if (metadata.workspace_id, metadata.session_id) != (ctx.workspace_id, ctx.session_id):
            raise DomainError("scope_mismatch", "私有续接不属于当前工作区和会话")
        run = load(tx, RunSnapshot, metadata.run_id)
        task = load(tx, TaskSnapshot, metadata.task_id)
        activity = load(tx, ActivitySnapshot, metadata.source_activity_id)
        if ((run.workspace_id, task.binding.execution_session_id) != (metadata.workspace_id, metadata.session_id)
                or task.run_id != run.id
                or (activity.run_id, activity.task_id) != (run.id, task.id)
                or activity.intent.kind != "model"
                or activity.state not in ({"dispatched"} if publishing else {"dispatched", "succeeded"})):
            raise DomainError("private_state_invalid", "私有续接不属于已派发模型活动")
        _match_profile(metadata, task.binding.config.model_profile)
        if ReplayCompatibility.from_profile(task.binding.config.model_profile) != ReplayCompatibility.from_profile(profile):
            raise DomainError("blocked_incompatible", "私有续接的协议、型号、目的地或adapter不兼容")
        if publishing and (metadata.run_id, metadata.task_id, metadata.source_activity_id) != (
                ctx.run_id, ctx.task_id, ctx.activity_id):
            raise DomainError("owner_mismatch", "候选私有续接不属于当前回执活动")
        # 发布时复核完整发送围栏；恢复时按受保护的实际输入provenance复核。
        # 旧dispatch临时展开的未观察正文epoch不是私有内容来源，不能阻止首次读后的续接。
        dependencies = [*metadata.source_dependencies, *run.scope_dependencies,
                         *(activity.intent.dependencies if publishing else [])]
        check_scopes(tx, dependencies)
        PolicyService.check_run_sources(tx, ctx, metadata.source_dependencies,
                                       source_run_id=metadata.run_id,source_task_id=metadata.task_id)
        return dependencies

    def _metadata(self, ctx, profile, message):
        if profile.protocol not in ADAPTER_IDS:
            raise DomainError("blocked_incompatible", "私有续接协议未支持")
        if message.private_ref is None or message.activity_id is None:
            raise DomainError("private_state_invalid", "私有续接需要预分配消息及活动引用")
        metadata = _Metadata(id=message.private_ref, adapter_id=ADAPTER_IDS[profile.protocol],
            protocol=profile.protocol, model_profile_id=profile.id,
            model_profile_version=profile.version, model_id=profile.model_id, endpoint=profile.endpoint,
            connection_id=profile.connection_id, connection_version=profile.connection_version,
            workspace_id=ctx.workspace_id, session_id=ctx.session_id, run_id=ctx.run_id,
            task_id=ctx.task_id, public_message_id=message.id, source_activity_id=message.activity_id,
            source_dependencies=message.source_dependencies, public_message_hash=_message_hash(message))
        with self.store.transaction(write=False) as tx:
            self._owner(tx, ctx, profile)
            dependencies = self._origin(tx, ctx, metadata, profile, message, publishing=True)
        return metadata, dependencies

    def _parse(self, value):
        try:
            if isinstance(value, str):
                value = json.loads(value)
            if not isinstance(value, dict):
                raise ValueError
            if (type(value.get("codec_version")) is not int or value.get("codec_version") != 1
                    or value.get("adapter_version") != "1" or value.get("sdk_version") != SDK_VERSION
                    or value.get("protocol") not in ADAPTER_IDS
                    or value.get("adapter_id") != ADAPTER_IDS[value["protocol"]]):
                raise DomainError("blocked_incompatible", "私有续接codec/adapter/SDK版本未支持")
            envelope = PrivateStateEnvelope.model_validate(value)
            blob = envelope.protected_blob.protected_b64
            if len(blob) > ((self.max_bytes + 4096) * 4 // 3 + 4):
                raise DomainError("private_state_too_large", "私有续接密文超出大小限制")
            base64.b64decode(blob, validate=True)
            return envelope
        except (ValueError, TypeError, KeyError, RecursionError, ValidationError):
            raise DomainError("private_state_invalid", "私有续接记录缺失或格式无效") from None

    async def encode(self, ctx: ExecutionContext, profile: ResolvedModelProfile, message: ModelMessage,
                     response: "ModelResponse") -> dict[str, JsonValue]:
        metadata, dependencies = self._metadata(ctx, profile, message)
        _allow(self.policy.check(ctx, dependencies, "model_send", destination=profile.endpoint))
        sdk = _sdk()
        _match_response(sdk, response, message, profile)
        adapter = sdk.ModelMessagesTypeAdapter
        try:
            data = adapter.dump_json([response], round_trip=True, warnings="error")
            if len(data) > self.max_bytes:
                raise DomainError("private_state_too_large", "私有续接内容超出大小限制")
            restored = adapter.validate_json(data)
            if (len(restored) != 1 or not isinstance(restored[0], sdk.ModelResponse)
                    or adapter.dump_json(restored, round_trip=True, warnings="error") != data):
                raise ValueError
        except DomainError:
            raise
        except Exception:
            raise DomainError("blocked_incompatible", "SDK响应无法无损保存为版本化消息JSON") from None
        context = metadata.model_dump(mode="json")
        protected = await self.secrets.protect(context, data)
        # DPAPI在事务外执行；返回候选前重检撤权/取消及活动归属。
        checked, dependencies = self._metadata(ctx, profile, message)
        if checked != metadata:
            raise DomainError("private_state_invalid", "私有续接保护期间消息身份已改变")
        _allow(self.policy.check(ctx, dependencies, "model_send", destination=profile.endpoint))
        envelope = self._parse({**context, "protected_blob": protected.model_dump(mode="json")})
        return envelope.model_dump(mode="json")

    def _read(self, ctx, profile, message):
        if message.private_ref is None:
            raise DomainError("private_state_missing", "消息缺少必需的私有续接引用")
        with self.store.transaction(write=False) as tx:
            self._owner(tx, ctx, profile)
            row = tx.execute("SELECT * FROM private_states WHERE id=?", (message.private_ref,)).fetchone()
            if row is None:
                raise DomainError("private_state_missing", "私有续接记录不可用，不能降级公开文本")
            envelope = self._parse(row["document"])
            if tuple(row[key] for key in ("id", "workspace_id", "session_id", "run_id", "task_id",
                                          "activity_id", "public_message_id")) != (
                    envelope.id, envelope.workspace_id, envelope.session_id, envelope.run_id,
                    envelope.task_id, envelope.source_activity_id, envelope.public_message_id):
                raise DomainError("private_state_invalid", "私有续接索引与记录身份不一致")
            dependencies = self._origin(tx, ctx, envelope, profile, message)
            public = tx.execute("SELECT run_id,task_id,document FROM messages WHERE id=?",
                                (message.id,)).fetchone()
            if public is None or (public[0], public[1]) != (envelope.run_id, envelope.task_id):
                raise DomainError("private_state_invalid", "私有续接缺少所属公开消息")
            try:
                stored_message = ModelMessage.model_validate_json(public[2])
            except ValidationError:
                raise DomainError("private_state_invalid", "私有续接的公开消息无效") from None
            _match_message(envelope, stored_message)
        return envelope, dependencies

    async def decode(self, ctx: ExecutionContext, profile: ResolvedModelProfile,
                     message: ModelMessage) -> "ModelResponse":
        sdk = _sdk()
        envelope, dependencies = self._read(ctx, profile, message)
        _allow(self.policy.check(ctx, dependencies, "model_send", destination=profile.endpoint))
        context = envelope.model_dump(mode="json", exclude={"protected_blob"})
        data = await self.secrets.unprotect(context, envelope.protected_blob)
        # 不依赖进入异步宿主前的旧读快照；解密后再检表、消息身份与当前用途授权。
        checked, dependencies = self._read(ctx, profile, message)
        if checked != envelope:
            raise DomainError("private_state_conflict", "解密期间私有续接记录已改变")
        _allow(self.policy.check(ctx, dependencies, "model_send", destination=profile.endpoint))
        if not isinstance(data, bytes) or len(data) > self.max_bytes:
            raise DomainError("private_state_too_large", "私有续接内容超出大小限制")
        try:
            messages = sdk.ModelMessagesTypeAdapter.validate_json(data)
            if len(messages) != 1 or not isinstance(messages[0], sdk.ModelResponse):
                raise ValueError
        except Exception:
            raise DomainError("blocked_incompatible", "私有续接不是兼容SDK消息JSON") from None
        _match_response(sdk, messages[0], message, profile)
        return messages[0]

    def publish(self, tx, ctx: ExecutionContext, states: list[dict[str, JsonValue]],
                messages: list[ModelMessage]) -> None:
        references = [message.private_ref for message in messages if message.private_ref is not None]
        if not states and not references:
            return
        _sdk()
        envelopes = [self._parse(state) for state in states]
        if (len({message.id for message in messages}) != len(messages)
                or len(set(references)) != len(references)
                or len({state.id for state in envelopes}) != len(envelopes)
                or set(references) != {state.id for state in envelopes}):
            raise DomainError("private_state_invalid", "私有候选与本次消息引用必须一一对应")
        profile = load(tx, TaskSnapshot, ctx.task_id).binding.config.model_profile
        self._owner(tx, ctx, profile)
        by_ref = {message.private_ref: message for message in messages if message.private_ref is not None}
        pending = []
        # 所有候选完成检查后才写入；调用方捕获校验错误也不会留下半批密文。
        for envelope in envelopes:
            message = by_ref[envelope.id]
            existing = tx.execute("SELECT document FROM private_states WHERE id=?", (envelope.id,)).fetchone()
            if existing is not None and self._parse(existing[0]) != envelope:
                raise DomainError("private_state_conflict", "同一私有续接身份不能更改内容")
            dependencies = self._origin(tx, ctx, envelope, profile, message, publishing=existing is None)
            if (envelope.run_id, envelope.task_id, envelope.source_activity_id) != (
                    ctx.run_id, ctx.task_id, ctx.activity_id):
                raise DomainError("owner_mismatch", "私有续接不属于当前回执")
            _allow(self.policy.check_tx(tx, ctx, dependencies, "model_send", destination=profile.endpoint))
            public = tx.execute("SELECT run_id,task_id,document FROM messages WHERE id=?", (message.id,)).fetchone()
            if public is not None:
                if (public[0], public[1]) != (ctx.run_id, ctx.task_id):
                    raise DomainError("private_state_conflict", "公开消息已属于另一活动范围")
                try:
                    _match_message(envelope, ModelMessage.model_validate_json(public[2]))
                except ValidationError:
                    raise DomainError("private_state_invalid", "公开消息记录无效") from None
            if existing is None:
                previous = tx.execute("SELECT id FROM private_states WHERE public_message_id=?",
                                      (message.id,)).fetchone()
                if previous is not None:
                    raise DomainError("private_state_conflict", "公开消息已绑定另一私有续接")
                pending.append(envelope)
        for envelope in pending:
            tx.execute("INSERT INTO private_states(id,workspace_id,session_id,run_id,task_id,"
                       "activity_id,public_message_id,document) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (envelope.id, envelope.workspace_id, envelope.session_id, envelope.run_id,
                        envelope.task_id, envelope.source_activity_id, envelope.public_message_id,
                        envelope.model_dump_json()))
