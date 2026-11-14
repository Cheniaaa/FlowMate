"""用户与模型配置契约。"""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field, model_validator

from flowmate.contracts.base import Contract, Id, Name, Version, identifier
from flowmate.contracts.pricing import Price as Price
from flowmate.contracts.pricing import PricingSnapshot


class ModelCapabilities(Contract):
    tools: bool | None = None
    thinking: bool | None = None
    structured_output: bool | None = None


class ModelPricing(Contract):
    provider_id: Name | None = None
    model_id: Name | None = None
    multiplier: Price | None = None
    input_per_million: Price | None = None
    output_per_million: Price | None = None
    cache_read_per_million: Price | None = None
    cache_write_per_million: Price | None = None
    currency: Literal["USD"] = "USD"


class AgentProfile(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    display_name: Name = "FlowMate"
    icon_id: Name = "assistant"
    communication_style: str = ""
    instructions: str = ""
    default_model_profile_id: Id | None = None


def _endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.port == 0
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or any(c.isspace() for c in value)
            or any(c in value for c in "?#\\")):
        raise ValueError("端点须为不含凭据、查询或fragment的HTTP(S) URL")
    return value


Endpoint = Annotated[str, AfterValidator(_endpoint)]
ModelProtocol = Literal["openai_compatible", "anthropic"]
OpenAIMaxTokensField = Literal["max_tokens", "max_completion_tokens"]


class ModelConnection(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    display_name: Name
    protocol: ModelProtocol
    endpoint: Endpoint
    secret_ref: Id | None = None
    provider_preset_id: Name | None = None


class ModelProfile(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    connection_id: Id
    model_id: Name
    display_name: Name | None = None
    context_window_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    max_output_tokens: int = Field(default=2048, gt=0, le=9007199254740991)
    request_timeout_seconds: float = Field(default=60.0, gt=0)
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    pricing: ModelPricing = Field(default_factory=ModelPricing)
    openai_max_tokens_field: OpenAIMaxTokensField | None = None

    @model_validator(mode="after")
    def check_capacity(self):
        if self.context_window_tokens is not None and self.max_output_tokens >= self.context_window_tokens:
            raise ValueError("输出限制必须小于模型上下文容量")
        return self


class MetadataSource(Contract):
    kind: Literal["user", "catalog", "application", "unknown"]
    source: str | None = None
    version: str | None = None
    verified_at: str | None = None
    note: str | None = None


class ProviderPreset(Contract):
    id: Name
    display_name: Name
    protocol: ModelProtocol
    default_endpoint: Endpoint
    auth_mode: Literal["api_key"] = "api_key"
    source_url: str
    source_version: str
    verified_at: str


class ModelCandidate(Contract):
    provider_preset_id: Name
    model_id: Name
    display_name: Name | None = None
    context_window_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    metadata_sources: dict[str, MetadataSource]


class ModelResolution(Contract):
    """预览允许有效容量缺失或输出超过容量，由blockers说明，不能充当Run快照。"""

    id: Id
    version: Version
    connection_id: Id
    connection_version: Version
    model_id: Name
    display_name: Name | None
    protocol: ModelProtocol
    endpoint: Endpoint
    secret_ref: Id | None
    provider_preset_id: Name | None
    context_window_tokens: int | None = Field(gt=0, le=9007199254740991)
    max_output_tokens: int = Field(gt=0, le=9007199254740991)
    request_timeout_seconds: float = Field(gt=0)
    capabilities: ModelCapabilities
    pricing: ModelPricing
    openai_max_tokens_field: OpenAIMaxTokensField | None
    metadata_sources: dict[str, MetadataSource]
    model_pricing: PricingSnapshot | None
    pricing_unknown_reason: str | None
    blockers: list[str]


class ResolvedModelProfile(ModelProfile):
    connection_version: Version
    protocol: ModelProtocol
    endpoint: Endpoint
    secret_ref: Id | None
    provider_preset_id: Name | None = None
    context_window_tokens: int = Field(gt=0, le=9007199254740991)
    metadata_sources: dict[str, MetadataSource] = Field(default_factory=dict)


class Workspace(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    name: Name
    directory_resource_id: Id | None = None


class Session(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    workspace_id: Id
    title: Name
    agent_profile_id: Id
