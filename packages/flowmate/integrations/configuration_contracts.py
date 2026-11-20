"""MCP 管理 DTO；只包含非秘密配置与待填写位置。"""

from typing import Literal

from pydantic import Field, model_validator

from flowmate.contracts.base import Contract, Id, Name, Version
from flowmate.contracts.scopes import ScopeRef
from flowmate.contracts.settings import Endpoint
from flowmate.integrations.contracts import McpCatalog, McpServerConfig
from flowmate.policy.contracts import DataUseGrant


class McpConfiguredServer(McpServerConfig):
    display_name: Name
    url: Endpoint | None = None

    @model_validator(mode="after")
    def check_transport(self):
        if self.scope.kind == "session":
            raise ValueError("MCP 只支持个人或项目范围")
        if self.transport == "stdio":
            if not self.command or not self.command.strip() or self.url or self.credential_ref:
                raise ValueError("stdio 须提供明确命令且不能混入 HTTP 配置")
        elif not self.url or self.command is not None or self.args or self.cwd or self.env_refs:
            raise ValueError("HTTP 须提供 URL 且不能混入进程配置")
        if any("\x00" in value or "${" in value for value in [
            self.command or "", self.cwd or "", *self.args,
        ]):
            raise ValueError("命令和参数不执行变量替换")
        if any(not name or "=" in name or "\x00" in name for name in self.env_refs):
            raise ValueError("环境变量名无效")
        return self


class McpSecretSlot(Contract):
    server_id: Id
    slot: str
    purpose: Literal["env", "http_token"]
    env_name: str | None = None


class McpImportPreview(Contract):
    configs: list[McpConfiguredServer] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    required_secret_slots: list[McpSecretSlot] = Field(default_factory=list)


class McpSelectTools(Contract):
    scope: ScopeRef
    config_revision: Version
    catalog_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    selected_names: list[str]


class McpToolSelection(McpSelectTools):
    server_id: Id
    version: Version


class McpServerView(Contract):
    config: McpConfiguredServer
    state: Literal["saved", "connecting", "connected", "failed", "stopped"]
    catalog: McpCatalog | None = None
    error_code: str | None = None
    selection: McpToolSelection | None = None
    query_grants: list[DataUseGrant] = Field(default_factory=list)


class McpSave(Contract):
    config: McpConfiguredServer
    confirmed: bool


class McpImportRequest(Contract):
    scope: ScopeRef
    sanitized_json: str


class McpNotice(Contract):
    server_id: Id
    config_revision: Version
    scope: ScopeRef
