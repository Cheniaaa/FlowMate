"""产品边界基本类型。"""

import re
from typing import Annotated
from uuid import uuid4

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)

Id = Annotated[str, StringConstraints(
    pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=256)]
CallId = Annotated[str, StringConstraints(min_length=1, max_length=256, pattern=r"\S")]
Count = Annotated[int, Field(ge=0, le=9007199254740991, strict=True)]
Version = Annotated[int, Field(ge=1, le=9007199254740991, strict=True)]


def identifier() -> str:
    return str(uuid4())


def _parse_units(value):
    if isinstance(value, str):
        if not re.fullmatch(r"0|[1-9][0-9]*", value):
            raise ValueError("金额必须为非负整数字符串")
        return int(value)
    return value


Units = Annotated[
    int, BeforeValidator(_parse_units), Field(ge=0, strict=True),
    PlainSerializer(str, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": r"^(0|[1-9][0-9]*)$"}),
]


class Contract(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, frozen=True, hide_input_in_errors=True,
        allow_inf_nan=False, validate_default=True,
        json_schema_serialization_defaults_required=True,
    )


class CommandMeta(Contract):
    command_id: Id = Field(default_factory=identifier)
    expected_version: Version | None = None


class DomainError(Exception):
    """只向调用者传递安全字段，不携带底层输入或异常正文。"""

    def __init__(
        self, code: str, safe_message: str = "", *, retryable: bool = False,
        related_ids: tuple[str, ...] = (),
    ):
        self.code = code
        self.safe_message = safe_message or code
        self.retryable = retryable
        self.related_ids = related_ids
        super().__init__(self.safe_message)
