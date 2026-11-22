"""离线精确元数据解析；SDK请求默认不作为已核实的外部能力。"""

import json
from functools import cache
from importlib.resources import files
from typing import get_args

from pydantic import TypeAdapter

from flowmate.contracts.base import DomainError
from flowmate.contracts.settings import (
    DiscoveredModel,
    MetadataSource,
    ModelCandidate,
    ModelCapabilities,
    ModelConnection,
    ModelProfile,
    ModelResolution,
    ProviderPreset,
    ReasoningEffort,
    ResolvedModelProfile,
    context_margin,
)
from flowmate.models.endpoints import resolve_model_endpoint
from flowmate.models.pricing import pricing_reason, resolve_pricing

DEFAULT_LOCAL_CONTEXT_TOKENS = 32_768


def _reasoning_efforts(connection: ModelConnection, model: ModelProfile, provider_id: str | None):
    levels = get_args(ReasoningEffort)
    declared = model.capabilities.reasoning_efforts
    if provider_id is None:
        # 用户对该连接和型号显式声明 SDK wire 字段可用。Messages 对应 adaptive thinking。
        allowed = levels[2:] if connection.protocol == "anthropic" else levels
        return [level for level in allowed if level in (declared or ())], (
            MetadataSource(kind="user", source="saved_model") if declared is not None
            else MetadataSource(kind="unknown"))

    supported = ()
    source = MetadataSource(kind="unknown")
    if provider_id == "openai" and connection.protocol == "openai_responses":
        # SDK 对某些型号只有开关信息。仅采纳 SDK 明确给出的档位集合，且要求该型号精确存在于目录。
        providers, _, _ = _model_index()
        if model.model_id in providers["openai"]:
            from pydantic_ai.profiles.openai import openai_model_profile

            supported = openai_model_profile(model.model_id).get("openai_reasoning_efforts", ())
            if supported:
                source = MetadataSource(kind="catalog", source="https://github.com/pydantic/pydantic-ai",
                    version="pydantic-ai-slim==2.65.0")
    elif provider_id == "openai" and model.model_id in {"gpt-5", "gpt-5-mini", "gpt-5-nano"}:
        # Chat Completions 和 Responses 能力不同，不能把 SDK 的 Responses 档位集合复用给 Chat。
        supported = ("minimal", "low", "medium", "high")
        source = MetadataSource(kind="catalog", source="https://developers.openai.com/api/docs/guides/reasoning")
    elif provider_id == "anthropic" and model.model_id == "claude-sonnet-5-5":
        supported = ("low", "medium", "high", "xhigh", "max")
        source = MetadataSource(kind="catalog", source="https://platform.claude.com/docs/en/build-with-claude/effort")

    if declared is not None and supported:
        supported = set(supported).intersection(declared)
        source = MetadataSource(kind="user", source="saved_model")
    return [level for level in levels if level in supported], source


def list_provider_presets() -> list[ProviderPreset]:
    return TypeAdapter(list[ProviderPreset]).validate_json(
        files("flowmate.models").joinpath("provider_presets.json").read_text("utf-8"))


def get_provider_preset(id: str) -> ProviderPreset:
    for preset in list_provider_presets():
        if preset.id == id:
            return preset
    raise DomainError("provider_preset_unknown", "未知的服务预设")


def official_provider_id(connection: ModelConnection | ResolvedModelProfile) -> str | None:
    """校验官方目的地，用于凭据、定价和提供方选择。"""
    if connection.provider_preset_id is None:
        return None
    preset = get_provider_preset(connection.provider_preset_id)
    endpoint = resolve_model_endpoint(connection.protocol, connection.endpoint)
    if endpoint.protocol != preset.protocol and not (preset.id == "openai" and endpoint.protocol == "openai_responses"):
        return None
    if endpoint.operation_url == resolve_model_endpoint(endpoint.protocol, preset.default_endpoint).operation_url:
        return preset.id
    return None


@cache
def _model_index():
    from genai_prices.data import providers

    by_provider = {provider.id: {item.id: item for item in provider.models} for provider in providers}
    by_id = {}
    for provider_id, models in by_provider.items():
        for name in models:
            by_id.setdefault(name, []).append(provider_id)
    verified = {}
    for entry in json.loads(files("flowmate.models").joinpath("model_metadata.json").read_text("utf-8")):
        for name in (entry["model_id"], *entry.get("aliases", ())):
            verified[name] = entry
    provider_ids = frozenset(preset.id for preset in list_provider_presets())
    for name, matches in by_id.items():
        # 原厂精确型号也会出现在转售平台目录。多个原厂同名仍保持歧义。
        originals = [owner for owner in matches if owner in provider_ids]
        if originals:
            by_id[name] = originals
    return by_provider, by_id, verified


def _catalog_candidate(model_id, protocol, provider_id=None):
    from genai_prices import __version__

    providers, owners, verified = _model_index()
    entry = verified.get(model_id)
    if entry and provider_id in (None, entry["provider_preset_id"]):
        provider_id = entry["provider_preset_id"]
        name = entry["model_id"]
    else:
        entry = {}
        name = model_id
        if provider_id is None:
            matches = owners.get(name, [])
            if len(matches) != 1:
                return None
            provider_id = matches[0]
    sdk_model = providers[provider_id].get(name)
    if sdk_model is None:
        return None
    sdk_source = MetadataSource(kind="catalog", source="https://github.com/pydantic/genai-prices",
        version=f"genai-prices=={__version__}")
    sources = {"model_id": sdk_source}
    limits = {}
    if sdk_model.context_window is not None:
        limits["max_input_tokens"] = sdk_model.context_window
        sources["max_input_tokens"] = sdk_source
    capabilities = {}
    if entry:
        source = MetadataSource(kind="catalog", source=entry["source_url"], version=entry["source_version"],
            verified_at=entry["verified_at"])
        capabilities = entry["capabilities"] | entry.get("protocol_capabilities", {}).get(protocol, {})
        for field in capabilities:
            sources[f"capabilities.{field}"] = source
        for field in ("context_window_tokens", "max_input_tokens", "max_output_tokens"):
            if field in entry:
                limits[field] = entry[field]
                sources[field] = source
    return ModelCandidate(provider_preset_id=provider_id, model_id=model_id, display_name=sdk_model.name,
        capabilities=ModelCapabilities(**capabilities), metadata_sources=sources, **limits)


class ModelMetadataResolver:
    @staticmethod
    def list_candidates(provider_preset_id: str, query: str = "") -> list[ModelCandidate]:
        preset = get_provider_preset(provider_preset_id)
        providers, _, _ = _model_index()
        return [_catalog_candidate(name, preset.protocol, preset.id) for name in sorted(providers[preset.id])
            if query.casefold() in name.casefold()]

    def preview(self, connection: ModelConnection, model: ModelProfile, *, discovered: DiscoveredModel | None = None,
                observed: dict[str, tuple[bool, str]] | None = None) -> ModelResolution:
        if connection.id != model.connection_id:
            raise DomainError("model_connection_mismatch", "模型不属于该连接")
        provider_id = official_provider_id(connection)
        name = discovered.canonical_id if discovered and discovered.canonical_id else model.model_id
        candidate = _catalog_candidate(name, connection.protocol, provider_id)
        unknown = MetadataSource(kind="unknown")
        user = MetadataSource(kind="user", source="saved_model")
        sources = {}
        service = MetadataSource(kind="service", source=connection.display_name)
        declarations = discovered.metadata_sources if discovered is not None else {}
        limits = {}
        for field, public_field in (("context_window_tokens", "context_window_tokens"),
                ("max_input_tokens", "max_input_tokens"), ("max_output_tokens", "max_supported_output_tokens")):
            value = getattr(discovered, field) if discovered is not None else None
            source = declarations.get(field, service) if value is not None else unknown
            if value is None and candidate is not None:
                value = getattr(candidate, field)
                source = candidate.metadata_sources.get(field, unknown)
            limits[public_field] = value
            sources[public_field] = source
        output_limit = limits["max_supported_output_tokens"]
        output = min(model.max_output_tokens, output_limit) if output_limit is not None else model.max_output_tokens
        budgets = []
        if model.context_window_tokens is not None:
            budgets.append((model.context_window_tokens, user.model_copy(update={"note": "local_budget: 用户设置的本地请求预算。"})))
        if limits["context_window_tokens"] is not None:
            budgets.append((limits["context_window_tokens"], sources["context_window_tokens"]))
        if limits["max_input_tokens"] is not None:
            usable = limits["max_input_tokens"] + output
            # 总量含至少 1024 或总量的 5% 余量。由可用的 95% 反推总量。
            total = min(9_007_199_254_740_991, usable + max(1024, (usable + 18) // 19))
            budgets.append((total, sources["max_input_tokens"]))
        budget, budget_source = min(budgets, key=lambda item: item[0]) if budgets else (
            DEFAULT_LOCAL_CONTEXT_TOKENS, MetadataSource(kind="application", source="flowmate_defaults",
                note="本地总预算包含输入、输出及安全余量。"))
        sources["local_context_budget_tokens"] = budget_source
        capabilities = {}
        for field in ModelCapabilities.model_fields:
            if field == "reasoning_efforts":
                capabilities[field], sources[f"capabilities.{field}"] = _reasoning_efforts(connection, model, provider_id)
                continue
            value = getattr(model.capabilities, field)
            source = user if value is not None else unknown
            if value is None and discovered is not None:
                value = getattr(discovered.capabilities, field)
                if value is not None:
                    source = declarations.get(f"capabilities.{field}", service)
            if source.kind != "user" and observed and field in observed:
                supported, timestamp = observed[field]
                if value is None or value and not supported:
                    value = supported
                    source = MetadataSource(kind="observed", source=connection.display_name, verified_at=timestamp)
            if value is None and candidate is not None:
                value = getattr(candidate.capabilities, field)
                source = candidate.metadata_sources.get(f"capabilities.{field}", unknown)
            capabilities[field] = value
            sources[f"capabilities.{field}"] = source
        for field in ("max_output_tokens", "request_timeout_seconds"):
            sources[field] = user if getattr(model, field) != ModelProfile.model_fields[field].default else (
                MetadataSource(kind="application", source="flowmate_defaults"))
        max_field = model.openai_max_tokens_field
        if connection.protocol == "openai_compatible":
            sources["openai_max_tokens_field"] = user if max_field is not None else MetadataSource(
                kind="application", source="pydantic-ai adapter default", version="pydantic-ai-slim==2.65.0",
                note="Request-shaping default; not a verified capability of this destination.")
            max_field = max_field or "max_completion_tokens"
        else:
            max_field = None
        blockers = []
        if output < model.max_output_tokens:
            sources["max_output_tokens"] = sources["max_supported_output_tokens"]
        if output + context_margin(budget) >= budget:
            blockers.append("output_exceeds_context")
        if connection.protocol != "openai_compatible" and model.openai_max_tokens_field is not None:
            blockers.append("openai_max_tokens_field_not_applicable")
        pricing = resolve_pricing(model, connection=connection)
        explicit_pricing = model.pricing.provider_id is not None or model.pricing.model_id is not None
        sources["pricing"] = MetadataSource(kind="unknown") if pricing is None else MetadataSource(
            kind="user" if pricing.mode == "manual" or explicit_pricing else "catalog",
            source=pricing.source, version=pricing.catalog_version)
        return ModelResolution(**(model.model_dump() | {
            "connection_version": connection.version, "protocol": connection.protocol,
            "endpoint": connection.endpoint, "secret_ref": connection.secret_ref,
            "provider_preset_id": provider_id, **limits, "local_context_budget_tokens": budget, "max_output_tokens": output,
            "capabilities": ModelCapabilities(**capabilities), "openai_max_tokens_field": max_field,
            "metadata_sources": sources, "model_pricing": pricing,
            "pricing_unknown_reason": pricing_reason(model) if pricing is None else None, "blockers": blockers,
        }))

    def resolve(self, connection: ModelConnection, model: ModelProfile, *, discovered=None, observed=None) -> ResolvedModelProfile:
        preview = self.preview(connection, model, discovered=discovered, observed=observed)
        if preview.blockers:
            raise DomainError("model_configuration_incomplete", "模型配置不能执行：" + ", ".join(preview.blockers))
        snapshot = preview.model_dump(exclude={"model_pricing", "pricing_unknown_reason", "blockers",
            "local_context_budget_tokens"})
        snapshot["context_window_tokens"] = preview.local_context_budget_tokens
        snapshot["metadata_sources"]["context_window_tokens"] = snapshot["metadata_sources"].pop("local_context_budget_tokens")
        if discovered is not None and discovered.canonical_id is not None:
            snapshot["canonical_model_id"] = discovered.canonical_id
            snapshot["metadata_sources"]["canonical_model_id"] = discovered.metadata_sources.get(
                "canonical_id", MetadataSource(kind="service", source=connection.display_name))
        return ResolvedModelProfile.model_validate(snapshot)
