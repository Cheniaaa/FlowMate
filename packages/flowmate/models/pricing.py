"""模型价格来源快照与纯离线费用计算。"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal, localcontext
from fractions import Fraction
from typing import TYPE_CHECKING

from flowmate.contracts.base import Contract
from flowmate.contracts.execution import ReservationEstimate
from flowmate.contracts.pricing import PriceRule, PriceTier, PriceVariant, PricingSnapshot
from flowmate.contracts.settings import (
    ModelConnection,
    ModelPricing,
    ModelProfile,
    Price,
    ResolvedModelProfile,
)

if TYPE_CHECKING:
    from genai_prices.types import ModelPrice

    from flowmate.knowledge.contracts import EmbeddingProfile

SCALE = 1_000_000_000


class PricingDefaults(Contract):
    default_multiplier: Price = Decimal(1)


def _has_manual_rates(pricing: ModelPricing) -> bool:
    return any(rate is not None for rate in (
        pricing.input_per_million, pricing.output_per_million,
        pricing.cache_read_per_million, pricing.cache_write_per_million,
    ))


def pricing_reason(profile: ModelProfile) -> str:
    """仅在解析未知时使用；不泄漏配置或目录异常正文。"""
    pricing = profile.pricing
    if _has_manual_rates(pricing) and (
        pricing.input_per_million is None or pricing.output_per_million is None
    ):
        return "price_incomplete"
    return "price_unknown"


def _rules(prices: ModelPrice) -> dict[str, PriceRule]:
    from genai_prices.types import TieredPrices

    return {
        key: PriceRule(base=value.base, tiers=[
            PriceTier(start=tier.start, price=tier.price) for tier in value.tiers
        ]) if isinstance(value, TieredPrices) else PriceRule(base=value)
        for key, value in prices.__dict__.items()
        if not key.startswith("_") and value is not None
    }


def resolve_pricing(
    profile: ModelProfile | EmbeddingProfile, defaults: PricingDefaults | None = None,
    *, connection: ModelConnection | None = None, input_only: bool = False,
) -> PricingSnapshot | None:
    """固定本次调用的规则、来源与倍率；不依赖协议或 endpoint 猜价格。"""
    now = datetime.now(UTC)
    pricing = ModelPricing(**profile.pricing.model_dump()) if input_only else profile.pricing
    if input_only and pricing.input_per_million is not None:
        pricing = pricing.model_copy(update={"output_per_million": Decimal(0)})
    manual = _has_manual_rates(pricing)
    assumptions = []
    if manual:
        if pricing.input_per_million is None or pricing.output_per_million is None:
            return None
        rates = {
            "input_mtok": pricing.input_per_million,
            "output_mtok": pricing.output_per_million,
            "cache_read_mtok": pricing.cache_read_per_million
            if pricing.cache_read_per_million is not None else pricing.input_per_million,
            "cache_write_mtok": pricing.cache_write_per_million
            if pricing.cache_write_per_million is not None else pricing.input_per_million,
        }
        rates["cache_write_1h_mtok"] = rates["cache_write_mtok"]
        if pricing.cache_read_per_million is None:
            assumptions.append("cache_read_at_input_rate")
        if pricing.cache_write_per_million is None:
            assumptions.append("cache_write_at_input_rate")
        assumptions.append("cache_write_1h_at_cache_write_rate")
        rules = {key: PriceRule(base=value) for key, value in rates.items()}
        source, provider, model, version, multiplier = (
            "manual-final", pricing.provider_id, pricing.model_id or profile.model_id,
            None, Decimal(1),
        )
        variants = []
    else:
        from genai_prices import __version__
        from genai_prices.data import providers
        from genai_prices.data_snapshot import DataSnapshot

        from flowmate.models.metadata import official_provider_id

        # 不使用模块级 calc_price/get_snapshot：它们可能读取自动更新的全局目录。
        catalog = DataSnapshot(providers=providers, from_auto_update=False)
        provider_id = pricing.provider_id
        if provider_id is None:
            destination = connection if connection is not None else (
                profile if isinstance(profile, ResolvedModelProfile) else None)
            provider_id = official_provider_id(destination) if destination is not None else None
        if provider_id is None:
            return None  # 自定义目的地必须显式映射计价provider，不能借同名型号套官方价。
        identity = pricing.model_id or profile.model_id
        try:
            found_provider, found_model = catalog.find_provider_model(
                identity, None, provider_id, None,
            )
        except (LookupError, ValueError):
            return None
        if (found_model.id != identity
                or found_provider.id != provider_id
                or not any(found_model is entry for entry in found_provider.models)):
            return None  # alias、近似匹配和跨 provider fallback 均不是确切计价身份。
        rules = _rules(found_model.get_prices(now))
        if "input_mtok" not in rules or (not input_only and "output_mtok" not in rules):
            return None
        variants = [
            PriceVariant(when=dict(variant.when), rules=_rules(variant.prices))
            for variant in found_model.price_variants or []
            if variant.constraint is None or variant.constraint.active(now)
        ]
        source, provider, model, version = (
            "genai-prices-bundled", found_provider.id, found_model.id, __version__,
        )
        multiplier = pricing.multiplier if pricing.multiplier is not None else (
            defaults or PricingDefaults()
        ).default_multiplier
    if input_only:
        rules["output_mtok"] = PriceRule(base=Decimal(0))
        assumptions.append("embedding_has_no_output")
    content = {
        "rules": {key: rule.model_dump(mode="json") for key, rule in rules.items()},
        "variants": [variant.model_dump(mode="json") for variant in variants],
        "provider": provider, "model": model, "version": version,
        "multiplier": str(multiplier), "source": source, "currency": pricing.currency,
        "assumptions": assumptions,
    }
    digest = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
    return PricingSnapshot(
        mode="manual" if manual else "catalog", source=source, provider=provider,
        model=model, currency=pricing.currency, catalog_version=version,
        snapshot_id=digest, resolved_at=now.isoformat(), effective_multiplier=multiplier,
        rules=rules, variants=variants, assumptions=assumptions,
    )


def _sdk_prices(rules: dict[str, PriceRule]) -> ModelPrice:
    from genai_prices.types import ModelPrice, Tier, TieredPrices

    return ModelPrice(**{
        key: TieredPrices(base=rule.base, tiers=[
            Tier(start=tier.start, price=tier.price) for tier in rule.tiers
        ]) if rule.tiers else rule.base
        for key, rule in rules.items()
    })


def _units(amount: Fraction) -> int:
    return (amount.numerator + amount.denominator - 1) // amount.denominator


def calculate_units(
    snapshot: PricingSnapshot, usage: dict[str, int | None],
    price_context: dict[str, str] | None = None,
) -> int | None:
    """input_tokens 包含所有 cache；1h 写量是总写量的子集。"""
    from genai_prices import Usage

    counts = {key: usage.get(key, 0) for key in (
        "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
        "cache_write_1h_tokens",
    )}
    counts["input_tokens"] = usage.get("input_tokens")
    counts["output_tokens"] = usage.get("output_tokens")
    if any(type(value) is not int or value < 0 for value in counts.values()):
        return None
    if (counts["cache_read_tokens"] + counts["cache_write_tokens"] > counts["input_tokens"]
            or counts["cache_write_1h_tokens"] > counts["cache_write_tokens"]):
        return None
    rules = dict(snapshot.rules)
    if "input_mtok" not in rules or "output_mtok" not in rules:
        return None
    price_context = price_context or {}
    if snapshot.mode == "catalog":
        for key, value in price_context.items():
            known = {variant.when[key] for variant in snapshot.variants if key in variant.when}
            if value not in known and not (key == "service_tier" and value in {"default", "standard"}):
                return None
    overrides = {}
    for variant in snapshot.variants:
        if all(price_context.get(key) == value for key, value in variant.when.items()):
            for key, rule in variant.rules.items():
                overrides.setdefault(key, rule)
    rules.update(overrides)
    if counts["cache_write_tokens"] and "cache_write_mtok" not in rules:
        return None
    if counts["cache_write_1h_tokens"] and "cache_write_1h_mtok" not in rules:
        return None
    # M1 只发送文本及自有工具；不调用原生 search/audio 等额外计费能力。
    # 确保 SDK Decimal 运算精确，再以 Fraction 乘倍率及向上取整，避开 float。
    decimals = [price for rule in rules.values() for price in (
        rule.base, *[tier.price for tier in rule.tiers],
    )]
    precision = 50 + sum(
        len(price.as_tuple().digits) + abs(price.as_tuple().exponent) for price in decimals
    )
    try:
        with localcontext() as context:
            context.prec = precision + max(len(str(value)) for value in counts.values())
            total = _sdk_prices(rules).calc_price(Usage(**counts))["total_price"]
        return _units(Fraction(total) * Fraction(snapshot.effective_multiplier) * SCALE)
    except ValueError:
        return None


def estimate_request(
    body: bytes, max_output_tokens: int, snapshot: PricingSnapshot | None,
) -> ReservationEstimate:
    """文本保守字节估算，图片使用有来源的本地像素预留；均非供应商精确 token。"""
    from flowmate.models.image_budget import image_input_budget

    input_estimate, input_estimate_source = image_input_budget(body)
    estimate = ReservationEstimate(
        estimated_units=None, input_estimate=input_estimate, max_output_tokens=max_output_tokens,
        input_estimate_source=input_estimate_source,
    )
    if snapshot is None or "input_mtok" not in snapshot.rules or "output_mtok" not in snapshot.rules:
        return estimate
    all_rules = [snapshot.rules, *[variant.rules for variant in snapshot.variants]]

    def maximum(keys: set[str]) -> Decimal:
        return max((
            price for rules in all_rules for key, rule in rules.items() if key in keys
            for price in (rule.base, *[tier.price for tier in rule.tiers])
        ), default=Decimal(0))

    # 对所有允许档位分别取最大费率；缓存是输入分区，不能再次相加。
    input_keys = {"input_mtok", "cache_read_mtok", "cache_write_mtok", "cache_write_1h_mtok"}
    amount = (
        estimate.input_estimate * Fraction(maximum(input_keys))
        + max_output_tokens * Fraction(maximum({"output_mtok"}))
    ) / 1_000_000
    amount += Fraction(maximum({"requests_kcount"})) / 1000
    return ReservationEstimate(
        estimated_units=_units(amount * Fraction(snapshot.effective_multiplier) * SCALE),
        input_estimate=estimate.input_estimate, max_output_tokens=estimate.max_output_tokens,
        input_estimate_source=estimate.input_estimate_source,
    )
