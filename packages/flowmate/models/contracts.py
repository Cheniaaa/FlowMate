"""模型边界DTO；provider-private候选仅用于回执事务，不进入公开事件。"""

from typing import Literal

from pydantic import Field, JsonValue

from flowmate.contracts.base import Contract, Count, Id
from flowmate.contracts.execution import ActivityReceipt, ModelMessage
from flowmate.contracts.settings import ResolvedModelProfile
from flowmate.tools.catalog import ToolSpec


class ModelRequest(Contract):
    profile: ResolvedModelProfile
    attempt_id: Id | None = None
    messages: list[ModelMessage]
    tools: list[ToolSpec] = Field(default_factory=list)
    instructions: str = ""
    max_output_tokens: Count
    projection_digest: str | None = None


class ProjectionEstimate(Contract):
    input_tokens: Count
    projection_digest: str


class ModelOutcome(Contract):
    response: ModelMessage | None = None
    receipt: ActivityReceipt
    error: str | None = None
    private_ref: Id | None = None
    private_state: dict[str, JsonValue] | None = Field(default=None, repr=False)


class ModelEvent(Contract):
    kind: Literal["text_delta", "reasoning_delta", "tool_delta", "terminal"]
    delta: JsonValue = None
    outcome: ModelOutcome | None = Field(default=None, repr=False)
