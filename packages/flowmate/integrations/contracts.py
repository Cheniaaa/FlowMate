"""MCP 非秘密配置、目录及单次协议回执。"""

from typing import Literal

from pydantic import Field, JsonValue

from flowmate.contracts.base import Contract, DomainError, Id, Version
from flowmate.contracts.scopes import ScopeRef


class McpServerConfig(Contract):
    id: Id
    revision: Version
    scope: ScopeRef
    transport: Literal["stdio", "http"]
    command: str | None = None
    args: list[str] = Field(default_factory=list)
    cwd: str | None = None
    env_refs: dict[str, Id] = Field(default_factory=dict)
    url: str | None = None
    credential_ref: Id | None = None
    enabled: bool = True


class McpLimits(Contract):
    request_timeout_seconds: float = Field(gt=0)
    max_catalog_bytes: int = Field(gt=0)
    max_result_bytes: int = Field(gt=0)
    max_pages: int = Field(gt=0)
    max_image_bytes: int = Field(default=4 * 1024 * 1024, gt=0)
    max_image_pixels: int = Field(default=16_000_000, gt=0)


class McpToolDefinition(Contract):
    name: str
    description: str | None
    input_schema: dict[str, JsonValue]
    output_schema: dict[str, JsonValue] | None
    annotations: dict[str, JsonValue] | None
    unavailable_reason: str | None = None


class McpCatalog(Contract):
    server_id: Id
    config_revision: Version
    content_hash: str
    tools: tuple[McpToolDefinition, ...]


class McpCallResult(Contract):
    server_id: Id
    config_revision: Version
    catalog_hash: str
    tool_name: str
    texts: tuple[str, ...]
    structured_content: JsonValue
    is_error: bool
    content: tuple[dict, ...] = Field(default_factory=tuple, exclude=True)


class McpCallFailure(DomainError):
    """confirmed=False 表示已派发但无法确认结果，不能重试。"""

    def __init__(self, code: str, safe_message: str, *, confirmed: bool):
        super().__init__(code, safe_message)
        self.confirmed = confirmed
