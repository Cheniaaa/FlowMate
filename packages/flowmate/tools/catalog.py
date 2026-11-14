"""显式工具目录与边界Schema。"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, JsonValue, ValidationError

from flowmate.contracts.base import Contract, DomainError, Name
from flowmate.contracts.execution import ScopeDependency, SourceObservation, StagedArtifact


class ToolSpec(Contract):
    name: Name
    version: Name
    input_schema: dict[str, JsonValue]
    result_schema: dict[str, JsonValue]
    background_supported: bool
    cancellation: Literal["cooperative", "best_effort", "none"]
    retry_class: Literal["read_only", "idempotent", "never"]
    required_purposes: list[Literal["read", "model_send", "export"]] = Field(default_factory=list)
    requires_approval: bool = False
    model_visible: bool = True


class ToolOutcome(Contract):
    result: JsonValue = None
    error: str | None = None
    confirmed: bool = True
    dependencies: list[ScopeDependency] = Field(default_factory=list)
    staged_artifacts: list[StagedArtifact] = Field(default_factory=list)
    source_observations: list[SourceObservation] = Field(default_factory=list)
    call_id: str | None = None
    task_kind: Literal["agent", "tool"] = "agent"


@dataclass(frozen=True)
class BoundTool:
    spec: ToolSpec
    handler: Callable[..., Awaitable[ToolOutcome]]
    input_model: type[BaseModel]
    result_model: type[BaseModel]
    resolve_dependencies: Callable | None

    def validate_input(self, value):
        try:
            return self.input_model.model_validate_json(
                json.dumps(value, allow_nan=False), strict=True, extra="forbid",
            )
        except (ValidationError, ValueError, TypeError):
            raise DomainError("tool_arguments_invalid", "工具参数不符合声明Schema") from None

    def validate_result(self, value):
        try:
            result = self.result_model.model_validate_json(
                json.dumps(value, allow_nan=False), strict=True, extra="forbid",
            )
            return result.model_dump(mode="json")
        except (ValidationError, ValueError, TypeError):
            raise DomainError("tool_result_invalid", "工具结果不符合声明Schema") from None


class ToolCatalog:
    def __init__(self):
        self._tools = {}

    def register(self, spec, handler, *, input_model, result_model, resolve_dependencies=None):
        if spec.name in self._tools:
            raise DomainError("tool_duplicate", "同名工具不能隐式替换")
        if (spec.input_schema != input_model.model_json_schema(mode="validation")
                or spec.result_schema != result_model.model_json_schema(mode="serialization")):
            raise DomainError("tool_schema_mismatch", "工具Schema与实际校验器不一致")
        if spec.required_purposes and resolve_dependencies is None:
            raise DomainError("tool_dependencies_required", "涉及资料用途的工具须声明来源解析器")
        self._tools[spec.name] = BoundTool(spec.model_copy(deep=True), handler, input_model,
                                          result_model, resolve_dependencies)

    def get(self, name, version):
        tool = self._tools.get(name)
        if tool is None or tool.spec.version != version:
            raise DomainError("tool_unavailable", "固定版本的工具未装配")
        return tool

    def snapshot(self):
        return {name: tool.spec.version for name, tool in self._tools.items()}

    def specs(self, *, model_only=True):
        return [tool.spec.model_copy(deep=True) for tool in self._tools.values()
                if not model_only or tool.spec.model_visible]
