"""仅模型层持有SDK投影；通过公开Direct API序列化，永不到达网络。"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field, replace

import httpx2
from pydantic_ai.direct import model_request_stream
from pydantic_ai.messages import ModelMessage
from pydantic_ai.messages import ModelResponse as SDKResponse
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.settings import ModelSettings

from flowmate.contracts.base import DomainError
from flowmate.models.contracts import ProjectionEstimate
from flowmate.models.endpoints import ModelEndpoint
from flowmate.models.pricing import estimate_request


class _CapturedRequest(BaseException):
    """SDK没有公开纯wire serializer；在本地transport边界截停，不伪造provider响应。"""

    def __init__(self, body: bytes):
        self.body = body


class _CaptureTransport(httpx2.AsyncBaseTransport):
    async def handle_async_request(self, request):
        raise _CapturedRequest(await request.aread())


@dataclass
class RequestProjection:
    messages: list[ModelMessage] = field(repr=False)
    parameters: ModelRequestParameters
    settings: ModelSettings
    body: bytes = field(default=b"", repr=False)

    async def serialize(self, profile, sdk_factory) -> None:
        async with httpx2.AsyncClient(transport=_CaptureTransport(), trust_env=False) as client:
            model = sdk_factory(profile, "projection-only-not-a-credential", client, {})
            # Codec已按来源Run审计并核对ReplayCompatibility。同一目的地的新连接只改变SDK namespace；
            # 在内存投影中重绑provider_name，避免SDK静默丢弃兼容签名；不改原envelope/内容/审计hash。
            self.messages = [replace(message, provider_name=model.system, canonical_system=model.canonical_system, parts=[
                replace(part, provider_name=model.system) if part.provider_name is not None else part
                for part in message.parts]) if isinstance(message, SDKResponse) else message
                for message in self.messages]
            try:
                async with model_request_stream(model, self.messages, model_settings=self.settings,
                        model_request_parameters=self.parameters, instrument=False):
                    raise DomainError("projection_failed", "模型序列化未在本地边界截停")
            except _CapturedRequest as captured:
                self.body = captured.body

    def estimate(self) -> ProjectionEstimate:
        # 与真实wire围栏共享既有UTF-8保守字节估算，不另算DTO或声称精确tokenizer。
        return ProjectionEstimate(input_tokens=estimate_request(self.body, 0, None).input_estimate,
            projection_digest=hashlib.sha256(self.body).hexdigest())


class ProjectionTransport(httpx2.AsyncBaseTransport):
    """真实SDK请求必须复用已计量投影，之后才进入原有GuardTransport。"""

    def __init__(self, projection: RequestProjection, guarded, endpoint: ModelEndpoint):
        self.projection = projection
        self.guarded = guarded
        self.endpoint = endpoint

    async def handle_async_request(self, request):
        if await request.aread() != self.projection.body:
            raise DomainError("projection_changed", "准备的模型投影与真实请求不一致")
        if request.method != "POST" or str(request.url) != self.endpoint.sdk_operation_url:
            raise DomainError("model_endpoint_mismatch", "SDK 模型请求目的地与选定连接不一致")
        if self.endpoint.operation_url != self.endpoint.sdk_operation_url:
            # 正文已由完整 SDK 序列化并核对；只映射唯一预期 URL，最终 Guard 仍检查确切地址。
            request.url = httpx2.URL(self.endpoint.operation_url)
        return await self.guarded.handle_async_request(request)

    async def aclose(self):
        await self.guarded.aclose()
