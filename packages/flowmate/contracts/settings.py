"""用户与模型配置契约。"""

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field, model_validator

from flowmate.contracts.base import Contract, Id, Name, Units, Version, identifier
from flowmate.contracts.pricing import Price as Price
from flowmate.contracts.pricing import PricingSnapshot

ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]


class ModelCapabilities(Contract):
    tools: bool | None = None
    thinking: bool | None = None
    structured_output: bool | None = None
    vision: bool | None = None
    reasoning_efforts: list[ReasoningEffort] | None = Field(
        default=None, exclude_if=lambda value: value is None)


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
    delegatable: bool = False
    allowed_tools: list[str] = Field(default_factory=list)
    skill_ids: list[Id] = Field(default_factory=list)


def _endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.port == 0
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or any(c.isspace() for c in value)
            or any(c in value for c in "?#\\")):
        raise ValueError("端点须为不含凭据、查询或fragment的HTTP(S) URL")
    return value


Endpoint = Annotated[str, AfterValidator(_endpoint)]
ModelProtocol = Literal["openai_compatible", "openai_responses", "anthropic"]
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
    kind: Literal["user", "service", "observed", "catalog", "application", "unknown"]
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
    max_input_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    max_output_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    metadata_sources: dict[str, MetadataSource]


class DiscoveredModel(Contract):
    model_id: Name
    display_name: Name | None = None
    canonical_id: Name | None = None
    context_window_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    max_input_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    max_output_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)
    metadata_sources: dict[str, MetadataSource] = Field(default_factory=dict)


class ModelDiscoveryResult(Contract):
    connection_id: Id
    connection_version: Version
    status: Literal["ready", "unavailable", "authentication_error", "error"]
    items: list[DiscoveredModel] = Field(default_factory=list)
    cached: bool = False
    fetched_at: str | None = None
    message: str


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
    max_input_tokens: int | None = Field(gt=0, le=9007199254740991)
    max_supported_output_tokens: int | None = Field(gt=0, le=9007199254740991)
    local_context_budget_tokens: int = Field(gt=0, le=9007199254740991)
    max_output_tokens: int = Field(gt=0, le=9007199254740991)
    request_timeout_seconds: float = Field(gt=0)
    capabilities: ModelCapabilities
    pricing: ModelPricing
    openai_max_tokens_field: OpenAIMaxTokensField | None
    metadata_sources: dict[str, MetadataSource]
    model_pricing: PricingSnapshot | None
    pricing_unknown_reason: str | None
    blockers: list[str]


def context_margin(total: int) -> int:
    return max(1024, (total + 19) // 20)


class ResolvedModelProfile(ModelProfile):
    connection_version: Version
    canonical_model_id: Name | None = None
    protocol: ModelProtocol
    endpoint: Endpoint
    secret_ref: Id | None
    provider_preset_id: Name | None = None
    context_window_tokens: int = Field(gt=0, le=9007199254740991)
    max_input_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    max_supported_output_tokens: int | None = Field(default=None, gt=0, le=9007199254740991)
    metadata_sources: dict[str, MetadataSource] = Field(default_factory=dict)
    reasoning_effort: ReasoningEffort | None = Field(default=None, exclude_if=lambda value: value is None)

    def input_budget(self, output_tokens: int) -> int:
        """所有输入在扣除本次输出和安全余量后，还须遵守独立输入限制。"""
        remaining = self.context_window_tokens - output_tokens - context_margin(self.context_window_tokens)
        return remaining if self.max_input_tokens is None else min(remaining, self.max_input_tokens)


class Workspace(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    name: Name
    directory_resource_id: Id | None = None


class TitleModelBinding(Contract):
    model_profile_id: Id
    model_version: Version
    connection_version: Version
    endpoint: str
    max_requests: int = Field(ge=1, le=1000)
    max_tokens: int = Field(ge=1, le=1_000_000)
    max_cost_units: Units | None = None


class TitlePolicy(Contract):
    workspace_id: Id
    version: Version | None = None
    binding: TitleModelBinding | None = None


class Session(Contract):
    id: Id = Field(default_factory=identifier)
    version: Version = 1
    workspace_id: Id
    title: Name
    agent_profile_id: Id
    kind: Literal["interaction", "execution"] = "interaction"
    archived: bool = False
    automatic_title: Literal["pending"] | Version | None = Field(default=None, exclude_if=lambda value: value is None)
