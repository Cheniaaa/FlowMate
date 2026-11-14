"""固定计价规则DTO；领域快照无需依赖模型适配实现。"""

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, WithJsonSchema

from flowmate.contracts.base import Contract

PRICE_PATTERN = r"^(?:\+?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|-0(?:\.0*)?(?:[eE][+-]?[0-9]+)?)$"
Price = Annotated[Decimal, Field(ge=0, allow_inf_nan=False),
    WithJsonSchema({"anyOf": [{"type": "number", "minimum": 0}, {"type": "string", "pattern": PRICE_PATTERN}]}, mode="validation"),
    WithJsonSchema({"type": "string", "pattern": PRICE_PATTERN}, mode="serialization")]


class PriceTier(Contract):
    start: int = Field(ge=0, strict=True)
    price: Price


class PriceRule(Contract):
    base: Price
    tiers: list[PriceTier] = Field(default_factory=list)


class PriceVariant(Contract):
    when: dict[str, str]
    rules: dict[str, PriceRule]


class PricingSnapshot(Contract):
    mode: Literal["catalog", "manual"]
    source: str
    provider: str | None
    model: str
    currency: Literal["USD"]
    catalog_version: str | None
    snapshot_id: str
    resolved_at: str
    effective_multiplier: Price
    rules: dict[str, PriceRule]
    variants: list[PriceVariant] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
