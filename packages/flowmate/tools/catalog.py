"""显式工具目录与边界Schema。"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from threading import Lock
from typing import Literal

from jsonschema.validators import validator_for
from pydantic import BaseModel, Field, JsonValue, ValidationError
from referencing import Registry
from referencing.exceptions import Unresolvable

from flowmate.contracts.base import Contract, DomainError, Name
from flowmate.contracts.execution import (
    CatalogVersions,
    McpToolSnapshot,
    ScopeDependency,
    SourceObservation,
    StagedArtifact,
)
from flowmate.policy.contracts import Purpose


class ToolSpec(Contract):
    name: Name
    version: Name
    description: str | None = None
    mcp: McpToolSnapshot | None = None
    input_schema: dict[str, JsonValue]
    result_schema: dict[str, JsonValue]
    background_supported: bool
    cancellation: Literal["cooperative", "best_effort", "none"]
    retry_class: Literal["read_only", "idempotent", "never"]
    required_purposes: list[Purpose] = Field(default_factory=list)
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


class ToolArgumentsError(DomainError):
    """只回传声明 Schema 的路径和规则，不回显参数或底层异常正文。"""

    def __init__(self, issues):
        super().__init__("tool_arguments_invalid", "工具参数不符合声明Schema")
        self.issues = issues


@dataclass(frozen=True)
class BoundTool:
    spec: ToolSpec
    handler: Callable[..., Awaitable[ToolOutcome]]
    input_model: type[BaseModel] | None
    result_model: type[BaseModel] | None
    resolve_dependencies: Callable | None
    namespace: str | None = None
    input_validator: Callable | None = None
    result_validator: Callable | None = None
    deferred_dispatch: bool = False

    def validate_input(self, value) -> dict[str, JsonValue]:
        try:
            encoded = json.dumps(value, allow_nan=False)
            if self.input_validator is not None:
                value = json.loads(encoded)
                if not isinstance(value, dict):
                    raise ValueError
                return self.input_validator(value)
            return self.input_model.model_validate_json(encoded, strict=True, extra="forbid").model_dump(mode="json")
        except (ValidationError, ValueError, TypeError, DomainError) as failure:
            if isinstance(failure, DomainError) and failure.code != "tool_arguments_invalid":
                raise
            issues = []
            validator = validator_for(self.spec.input_schema)(self.spec.input_schema, registry=Registry())
            try:
                for error in validator.iter_errors(value):
                    issue = {"schema_path": list(error.absolute_schema_path), "rule": error.validator}
                    if error.validator in {"type", "required", "additionalProperties"}:
                        issue["expected"] = error.validator_value
                    issues.append(issue)
            except Unresolvable:
                # 输入已被真实校验器拒绝；补充诊断引用无效不能覆盖原始结构化错误。
                issues.append({"schema_path": [], "rule": "schema_reference_invalid"})
            raise ToolArgumentsError(issues or [{"schema_path": [], "rule": "schema"}]) from None

    def validate_result(self, value) -> JsonValue:
        try:
            if self.result_validator is not None:
                return self.result_validator(json.loads(json.dumps(value, allow_nan=False)))
            result = self.result_model.model_validate_json(
                json.dumps(value, allow_nan=False), strict=True, extra="forbid",
            )
            return result.model_dump(mode="json")
        except (ValidationError, ValueError, TypeError):
            raise DomainError("tool_result_invalid", "工具结果不符合声明Schema") from None


class ToolCatalog:
    def __init__(self):
        self._tools = {}
        self._write_lock = Lock()

    def register(self, spec, handler, *, input_model, result_model, resolve_dependencies=None):
        if (spec.input_schema != input_model.model_json_schema(mode="validation")
                or spec.result_schema != result_model.model_json_schema(mode="serialization")):
            raise DomainError("tool_schema_mismatch", "工具Schema与实际校验器不一致")
        if spec.required_purposes and resolve_dependencies is None:
            raise DomainError("tool_dependencies_required", "涉及资料用途的工具须声明来源解析器")
        with self._write_lock:
            if spec.name in self._tools:
                raise DomainError("tool_duplicate", "同名工具不能隐式替换")
            self._tools = {**self._tools, spec.name: BoundTool(spec.model_copy(deep=True), handler,
                input_model, result_model, resolve_dependencies)}

    def publish_namespace(self, namespace: str, tools: list[BoundTool]) -> None:
        replacements = {}
        for tool in tools:
            owner, _, key = tool.spec.name.rpartition(".")
            if owner != namespace or not key:
                raise DomainError("tool_namespace_mismatch", "工具与发布的命名空间不符")
            if tool.spec.name in replacements:
                raise DomainError("tool_duplicate", "目录中有工具名称冲突")
            if tool.spec.required_purposes and tool.resolve_dependencies is None:
                raise DomainError("tool_dependencies_required", "涉及资料用途的工具须声明来源解析器")
            replacements[tool.spec.name] = replace(tool, spec=tool.spec.model_copy(deep=True), namespace=namespace)
        with self._write_lock:
            retained = {name: tool for name, tool in self._tools.items() if tool.namespace != namespace}
            if retained.keys() & replacements.keys():
                raise DomainError("tool_duplicate", "不能替换其他提供方的工具")
            self._tools = retained | replacements

    def get(self, name, version):
        tool = self._tools.get(name)
        if tool is None or tool.spec.version != version:
            if name.startswith("mcp."):
                raise DomainError("blocked_incompatible", "任务固定的 MCP 工具版本已不可用")
            raise DomainError("tool_unavailable", "固定版本的工具未装配")
        return tool

    def snapshot(self):
        return {name: tool.spec.version for name, tool in self._tools.items()}

    def execution_snapshot(self):
        tools = self._tools
        return CatalogVersions(tools={name: tool.spec.version for name, tool in tools.items()},
            mcp_tools={name: tool.spec.mcp.model_copy(deep=True) for name, tool in tools.items()
                if tool.spec.mcp is not None})

    def specs(self, *, model_only=True):
        return [tool.spec.model_copy(deep=True) for tool in self._tools.values()
                if not model_only or tool.spec.model_visible]
