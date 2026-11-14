"""离线精确元数据解析；SDK请求默认不作为已核实的外部能力。"""

import json
from importlib.resources import files

from pydantic import TypeAdapter

from flowmate.contracts.base import DomainError
from flowmate.contracts.settings import (
    MetadataSource,
    ModelCandidate,
    ModelCapabilities,
    ModelConnection,
    ModelProfile,
    ModelResolution,
    ProviderPreset,
    ResolvedModelProfile,
)
from flowmate.models.pricing import pricing_reason, resolve_pricing


def list_provider_presets() -> list[ProviderPreset]:
    return TypeAdapter(list[ProviderPreset]).validate_json(
        files("flowmate.models").joinpath("provider_presets.json").read_text("utf-8"))


def get_provider_preset(id: str) -> ProviderPreset:
    for preset in list_provider_presets():
        if preset.id == id:
            return preset
    raise DomainError("provider_preset_unknown", "未知的服务预设")


def official_provider_id(connection: ModelConnection | ResolvedModelProfile) -> str | None:
    """仅精确保存的官方预设及目的地可使用官方目录，不按域名猜测。"""
    if connection.provider_preset_id is None:
        return None
    preset = get_provider_preset(connection.provider_preset_id)
    if (connection.protocol, connection.endpoint) == (preset.protocol, preset.default_endpoint):
        return preset.id
    return None


class ModelMetadataResolver:
    @staticmethod
    def list_candidates(provider_preset_id: str, query: str = "") -> list[ModelCandidate]:
        from genai_prices import __version__
        from genai_prices.data import providers

        get_provider_preset(provider_preset_id)
        source = MetadataSource(kind="catalog", source="https://github.com/pydantic/genai-prices",
            version=f"genai-prices=={__version__}")
        metadata = json.loads(files("flowmate.models").joinpath("model_metadata.json").read_text("utf-8"))
        verified = {entry["model_id"]: entry for entry in metadata
            if entry["provider_preset_id"] == provider_preset_id}
        candidates = []
        for provider in providers:
            if provider.id != provider_preset_id:
                continue
            for model in provider.models:
                if query.casefold() not in model.id.casefold():
                    continue
                sources = {"model_id": source}
                if model.context_window is not None:
                    sources["context_window_tokens"] = source.model_copy(update={
                        "note": "input_limit: genai-prices context_window is an input limit; used conservatively as the local total request budget."})
                capabilities = ModelCapabilities()
                entry = verified.get(model.id)
                if entry is not None:
                    capabilities = ModelCapabilities.model_validate(entry["capabilities"])
                    for field in entry["capabilities"]:
                        sources[f"capabilities.{field}"] = MetadataSource(kind="catalog",
                            source=entry["source_url"], version=entry["source_version"],
                            verified_at=entry["verified_at"], note=entry.get("note"))
                candidates.append(ModelCandidate(provider_preset_id=provider.id, model_id=model.id,
                    display_name=model.name, context_window_tokens=model.context_window,
                    capabilities=capabilities, metadata_sources=sources))
        return sorted(candidates, key=lambda item: item.model_id)

    def preview(self, connection: ModelConnection, model: ModelProfile) -> ModelResolution:
        if connection.id != model.connection_id:
            raise DomainError("model_connection_mismatch", "模型不属于该连接")
        provider_id = official_provider_id(connection)
        candidate = next((item for item in self.list_candidates(provider_id, model.model_id)
            if item.model_id == model.model_id), None) if provider_id is not None else None
        unknown = MetadataSource(kind="unknown")
        user = MetadataSource(kind="user", source="saved_model")
        sources = {}
        capacity = model.context_window_tokens
        if capacity is not None:
            sources["context_window_tokens"] = user.model_copy(update={"note": "local_budget: user-declared local request budget, not a verified provider limit."})
        elif candidate is not None and candidate.context_window_tokens is not None:
            capacity = candidate.context_window_tokens
            sources["context_window_tokens"] = candidate.metadata_sources["context_window_tokens"]
        else:
            sources["context_window_tokens"] = unknown
        capabilities = {}
        for field in ("tools", "thinking"):
            value = getattr(model.capabilities, field)
            source = user if value is not None else unknown
            if value is None and candidate is not None:
                value = getattr(candidate.capabilities, field)
                source = candidate.metadata_sources.get(f"capabilities.{field}", unknown)
            capabilities[field] = value
            sources[f"capabilities.{field}"] = source
        capabilities["structured_output"] = False
        sources["capabilities.structured_output"] = MetadataSource(kind="application", source="not_implemented")
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
        if capacity is None:
            blockers.append("context_window_unknown")
        elif model.max_output_tokens >= capacity:
            blockers.append("output_exceeds_context")
        if capabilities["tools"] is not True:
            blockers.append("tools_unknown" if capabilities["tools"] is None else "tools_unsupported")
        if model.capabilities.structured_output is True:
            blockers.append("structured_output_not_implemented")
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
            "provider_preset_id": provider_id, "context_window_tokens": capacity,
            "capabilities": ModelCapabilities(**capabilities), "openai_max_tokens_field": max_field,
            "metadata_sources": sources, "model_pricing": pricing,
            "pricing_unknown_reason": pricing_reason(model) if pricing is None else None, "blockers": blockers,
        }))

    def resolve(self, connection: ModelConnection, model: ModelProfile) -> ResolvedModelProfile:
        preview = self.preview(connection, model)
        if preview.blockers:
            raise DomainError("model_configuration_incomplete", "模型配置不能执行：" + ", ".join(preview.blockers))
        return ResolvedModelProfile.model_validate(preview.model_dump(exclude={
            "model_pricing", "pricing_unknown_reason", "blockers"}))
