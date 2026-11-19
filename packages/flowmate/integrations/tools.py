"""服务器及原工具名到模型可用身份的稳定映射。"""

import base64
import hashlib
import json
from uuid import UUID

from jsonschema.exceptions import ValidationError
from referencing.exceptions import Unresolvable

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import McpToolSnapshot, ScopeDependency
from flowmate.integrations.contracts import McpServerConfig
from flowmate.integrations.mcp import _json_bytes, _validator
from flowmate.integrations.public import public_catalog
from flowmate.tools.catalog import BoundTool, ToolOutcome, ToolSpec


def mcp_namespace(server_id: str) -> str:
    key = base64.urlsafe_b64encode(UUID(server_id).bytes).decode("ascii").rstrip("=")
    return f"mcp.{key}"


def mcp_tool_name(server_id: str, original_name: str) -> str:
    # 192 位摘要占 32 字符。两个分隔点经 wire_names 编码后总长 61。
    digest = hashlib.sha256(original_name.encode("utf-8")).digest()[:24]
    key = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"{mcp_namespace(server_id)}.{key}"


def mcp_destination(config):
    return f"mcp:{config.id}:{config.revision}:{config.url if config.transport == 'http' else 'stdio'}"


def configured_server(tx, server_id):
    row = tx.execute("SELECT document FROM mcp_servers WHERE id=?", (server_id,)).fetchone()
    if row is None:
        raise DomainError("mcp_server_unavailable", "MCP 配置不存在")
    value = json.loads(row[0])
    return McpServerConfig.model_validate({key: item for key, item in value.items()
        if key in McpServerConfig.model_fields})


def check_destination(tx, destination):
    parts = (destination or "").split(":", 3)
    if len(parts) != 4 or parts[0] != "mcp":
        raise DomainError("invalid_destination", "工具发送必须绑定实际 MCP 配置")
    config = configured_server(tx, parts[1])
    if not config.enabled or mcp_destination(config) != destination:
        raise DomainError("invalid_destination", "工具发送目的地与当前配置不一致")
    return config


class McpTools:
    def __init__(self, catalog, runtime_catalog, manager, store):
        self.catalog = catalog
        self.manager = manager
        self.store = store
        runtime_catalog.tool_catalog = catalog

    def read(self, server_id):
        return public_catalog(self.manager.catalog(server_id))

    def apply(self, server_id, catalog_hash, selected_names):
        with self.store.transaction(write=False) as tx:
            config = configured_server(tx, server_id)
        snapshot = self.manager.catalog(server_id)
        if snapshot.content_hash != catalog_hash:
            raise DomainError("blocked_incompatible", "所确认目录已改变，请重新读取并确认")
        self.publish(config, snapshot, selected_names)
        return public_catalog(snapshot)

    async def select(self, server_id, selected_names, *, catalog_hash=None):
        # 保持异步调用接口；选择只消费已有目录，调用前复核由 manager.call 负责。
        if catalog_hash is None:
            catalog_hash = self.manager.catalog(server_id).content_hash
        return self.apply(server_id, catalog_hash, selected_names)

    def publish(self, config, snapshot, selected_names, *, tx=None):
        if tx is None:
            with self.store.transaction() as tx:
                return self.publish(config, snapshot, selected_names, tx=tx)
        config = config.model_copy(deep=True)
        snapshot = snapshot.model_copy(deep=True)
        # 完整可信目录与显式选择均先校验，失败不会发布部分工具。
        if (snapshot.server_id != config.id or snapshot.config_revision != config.revision
                or snapshot.content_hash != hashlib.sha256(_json_bytes(
                    snapshot.model_dump(mode="json", exclude={"content_hash"}))).hexdigest()):
            raise DomainError("mcp_catalog_invalid", "目录与实际配置或内容摘要不一致")
        if configured_server(tx, config.id) != config or not config.enabled:
            raise DomainError("blocked_incompatible", "配置已改变或停用")
        definitions = {item.name: item for item in snapshot.tools}
        if len(set(selected_names)) != len(selected_names) or set(selected_names) - definitions.keys():
            raise DomainError("mcp_tool_unavailable", "所选工具不属于固定目录")
        tools = [self._bind(config, snapshot, definitions[name]) for name in selected_names]
        row = tx.execute("SELECT kind FROM scopes WHERE id=?", (config.id,)).fetchone()
        if row is not None and row[0] != "mcp":
            raise DomainError("mcp_scope_conflict", "MCP 身份已被其它来源占用")
        tx.execute("INSERT INTO scopes(id,epoch,status,kind,workspace_id) VALUES (?,?,'active','mcp',?) "
            "ON CONFLICT(id) DO UPDATE SET epoch=excluded.epoch,status='active'",
            (config.id, config.revision, config.scope.workspace_id))
        self.catalog.publish_namespace(mcp_namespace(config.id), tools)

    def invalidate(self, tx, server_id, revision):
        self.catalog.publish_namespace(mcp_namespace(server_id), [])
        tx.execute("UPDATE scopes SET epoch=?,status='revoked' WHERE id=? AND kind='mcp'",
            (revision, server_id))

    def _bind(self, config, snapshot, definition):
        if definition.unavailable_reason is not None:
            raise DomainError(definition.unavailable_reason, "所选工具 Schema 不受支持")
        input_schema = _validator(definition.input_schema)
        output_schema = _validator(definition.output_schema) if definition.output_schema is not None else None
        binding = McpToolSnapshot(server_id=config.id, config_revision=config.revision,
            catalog_hash=snapshot.content_hash, original_name=definition.name,
            destination=mcp_destination(config))
        spec = ToolSpec(name=mcp_tool_name(config.id, definition.name),
            version=f"{config.revision}:{snapshot.content_hash}", mcp=binding,
            description=f"{definition.name}\n{definition.description or ''}",
            input_schema=definition.input_schema, result_schema=definition.output_schema or {},
            background_supported=False, cancellation="best_effort", retry_class="never",
            required_purposes=["tool_send"], requires_approval=True)

        def validate_input(value):
            try:
                input_schema.validate(value)
            except (ValidationError, Unresolvable):
                raise DomainError("tool_arguments_invalid", "工具参数不符合声明 Schema") from None
            return value

        def validate_result(value):
            if output_schema is not None:
                try:
                    output_schema.validate(value["structured_content"])
                except (ValidationError, Unresolvable):
                    raise DomainError("tool_result_invalid", "工具结果不符合声明 Schema") from None
            return value

        async def handler(ctx, args, cancel, *, before_send):
            result = await self.manager.call(config.id, snapshot.content_hash, definition.name, args, cancel,
                before_send=before_send)
            payload = result.model_dump(mode="json")
            return ToolOutcome(result={**payload, "result_hash": hashlib.sha256(_json_bytes(payload)).hexdigest(),
                "destination": binding.destination, "external_cost_status": "unknown"},
                error="mcp_tool_error" if result.is_error else None,
                dependencies=[ScopeDependency(scope_id=config.id, epoch=config.revision)])

        return BoundTool(spec, handler, None, None, lambda tx, ctx, args: {"tool_send": []},
            input_validator=validate_input, result_validator=validate_result, deferred_dispatch=True)
