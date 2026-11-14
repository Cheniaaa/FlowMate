"""受控澄清与完成契约。"""

import json
from typing import Literal

from pydantic import Field, JsonValue, RootModel

from flowmate.config import MAX_QUESTION_FIELDS, MAX_QUESTION_OPTIONS
from flowmate.contracts.base import Contract, DomainError, Version
from flowmate.contracts.execution import (
    RunOutput,
    SubmitToolTask,
    TaskHandle,
    TaskResult,
    TaskSnapshot,
    TaskSubmission,
    WaitOutcome,
)
from flowmate.tools.catalog import ToolSpec


class AskInput(Contract):
    question: str = Field(min_length=1, max_length=4000)
    answer_schema: dict[str, JsonValue] = Field(description=(
        "用户可直接填写的内联JSON Schema：string/boolean/integer/number、标量enum、"
        f"最多{MAX_QUESTION_FIELDS}字段的扁平object或enum数组，多选items必须是标量enum，"
        f"每组最多{MAX_QUESTION_OPTIONS}选项。nullable用type:[单一类型,'null']；"
        "支持title/description、required、长度/数值边界、minItems/maxItems/uniqueItems。"
        "不支持嵌套object、$ref、组合Schema或正则；不能要求用户编辑JSON。"))


class FinishInput(Contract):
    """提交完成结果。仅在任务要求均已满足时调用，业务待确认事项保留在交付内容中。"""

    output: RunOutput


class ControlResult(Contract):
    accepted: bool
    reason: str | None = None


class TaskInput(Contract):
    handle: TaskHandle


class AwaitTaskInput(TaskInput):
    timeout_seconds: float | None = Field(default=None, ge=0)


class CancelTaskInput(TaskInput):
    expected_version: Version


class ConsumedTaskResult(Contract):
    handle: TaskHandle
    result_version: Version
    already_consumed: Literal[True] = True


def validate_question_schema(schema: dict, *, max_fields: int, max_options: int) -> None:
    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import SchemaError

    if len(json.dumps(schema).encode()) > 16384:
        raise DomainError("answer_schema_invalid", "回答Schema超限")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError:
        raise DomainError("answer_schema_invalid", "回答Schema无效") from None

    def check(value, *, root=False):
        if not isinstance(value, dict):
            raise DomainError("answer_schema_invalid", "回答Schema需要明确字段类型")
        kind = value.get("type")
        if isinstance(kind, list):
            if len(kind) != 2 or "null" not in kind:
                raise DomainError("answer_schema_invalid", "只支持单类型nullable字段")
            kind = next(item for item in kind if item != "null")
        options = value.get("enum")
        if options is not None and (not 1 <= len(options) <= max_options
                or any(isinstance(option, (dict, list)) for option in options)):
            raise DomainError("answer_schema_invalid", "回答选项须为有界标量枚举")
        if options is not None:
            option_types = {"null" if option is None else "boolean" if isinstance(option, bool) else
                            "number" if isinstance(option, (int, float)) else "string" for option in options}
            permitted = {"number" if kind == "integer" else kind}
            if isinstance(value.get("type"), list) and "null" in value["type"]:
                permitted.add("null")
            if (kind is None and (len(option_types) != 1 or "null" in option_types)
                    or kind is not None and not option_types <= permitted):
                raise DomainError("answer_schema_invalid", "枚举须使用同类标量，null需要显式nullable类型")
        allowed = {"type", "title", "description", "enum"}
        if kind == "object" and root and options is None:
            allowed |= {"properties", "required", "additionalProperties"}
            fields = value.get("properties", {})
            if (len(fields) > max_fields or not set(value.get("required", [])) <= fields.keys()
                    or value.get("additionalProperties", False) is not False):
                raise DomainError("answer_schema_invalid", "回答对象须使用有限的明确字段")
            for field in fields.values():
                check(field)
        elif kind == "array" and options is None:
            allowed |= {"items", "minItems", "maxItems", "uniqueItems"}
            items = value.get("items")
            if not isinstance(items, dict) or "enum" not in items:
                raise DomainError("answer_schema_invalid", "多选字段须使用标量枚举items")
            check(items)
        elif kind == "string":
            allowed |= {"minLength", "maxLength"}
        elif kind in {"number", "integer"}:
            allowed |= {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"}
        elif kind != "boolean" and not (kind is None and options is not None):
            raise DomainError("answer_schema_invalid", "回答Schema包含不支持的字段类型")
        if set(value) - allowed:
            raise DomainError("answer_schema_invalid", "回答Schema包含不支持的规则")
    check(schema, root=True)


def answer_validator(schema):
    from jsonschema import Draft202012Validator
    from referencing import Registry

    validate_question_schema(schema, max_fields=MAX_QUESTION_FIELDS, max_options=MAX_QUESTION_OPTIONS)
    return Draft202012Validator(schema, registry=Registry())


def register_control_tools(catalog):
    async def controlled(*args):
        raise DomainError("control_only", "控制能力须由Agent持久转换处理")
    for name, model in (("user.ask", AskInput), ("run.finish", FinishInput)):
        catalog.register(ToolSpec(name=name, version="1", input_schema=model.model_json_schema(),
            result_schema=ControlResult.model_json_schema(mode="serialization"), background_supported=False,
            cancellation="none", retry_class="never"), controlled,
            input_model=model, result_model=ControlResult)
    read_result = TaskResult | ConsumedTaskResult
    for name, model, result in (
        ("task.submit", SubmitToolTask, TaskSubmission | TaskResult | ConsumedTaskResult | WaitOutcome),
        ("task.status", TaskInput, TaskSnapshot), ("task.result", TaskInput, read_result),
        ("task.await", AwaitTaskInput, read_result | WaitOutcome),
        ("task.cancel", CancelTaskInput, TaskSnapshot),
    ):
        result_model = RootModel[result]
        catalog.register(ToolSpec(name=name, version="1", input_schema=model.model_json_schema(),
            result_schema=result_model.model_json_schema(mode="serialization"), background_supported=False,
            cancellation="none", retry_class="never"), controlled, input_model=model, result_model=result_model)
