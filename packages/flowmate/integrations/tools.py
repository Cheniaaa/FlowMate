"""服务器及原工具名到模型可用身份的稳定映射。"""

import base64
import hashlib
import json
from functools import cache, partial
from uuid import UUID

from jsonschema.exceptions import ValidationError
from referencing.exceptions import Unresolvable

from flowmate.contracts.base import DomainError
from flowmate.contracts.execution import (
    ActivitySnapshot,
    McpToolSnapshot,
    ScopeDependency,
)
from flowmate.integrations.contracts import McpCatalog, McpServerConfig
from flowmate.integrations.mcp import _json_bytes, _validator
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


def stored_catalog(tx, server_id, catalog_hash):
    row = tx.execute("SELECT document FROM mcp_catalogs WHERE server_id=? AND catalog_hash=?",
        (server_id, catalog_hash)).fetchone()
    if row is None:
        raise DomainError("blocked_incompatible", "任务固定的 MCP 目录不存在")
    catalog = McpCatalog.model_validate_json(row[0])
    if (catalog.server_id != server_id or catalog.content_hash != catalog_hash
            or hashlib.sha256(_json_bytes(catalog.model_dump(mode="json",
                exclude={"content_hash"}))).hexdigest() != catalog_hash):
        raise DomainError("mcp_catalog_invalid", "存储目录与固定身份不一致")
    return catalog


def compatible_tool(config, current, fixed, original_name):
    definition = next((tool for tool in fixed.tools if tool.name == original_name), None)
    latest = next((tool for tool in current.tools if tool.name == original_name), None)
    if (fixed.config_revision != config.revision or current.config_revision != config.revision
            or definition is None or definition.unavailable_reason is not None or latest != definition):
        raise DomainError("blocked_incompatible", "任务固定的 MCP 工具定义已改变")
    return definition


def require_compatible_bindings(tx, changes):
    # 多个工具共享配置及目录。每次恢复只读取和校验一次，各工具仍分别核对。
    server_for = cache(partial(configured_server, tx))
    catalog_for = cache(partial(stored_catalog, tx))
    for name, current_version, current, saved_version, saved in changes:
        config = server_for(current.server_id)
        if (not config.enabled or current.server_id != saved.server_id
                or current.config_revision != config.revision or saved.config_revision != config.revision
                or current.original_name != saved.original_name
                or current.destination != mcp_destination(config) or saved.destination != current.destination
                or name != mcp_tool_name(config.id, current.original_name)
                or current_version != f"{config.revision}:{current.catalog_hash}"
                or saved_version != f"{config.revision}:{saved.catalog_hash}"):
            raise DomainError("blocked_incompatible", "任务固定的 MCP 连接或工具身份已改变")
        compatible_tool(config, catalog_for(config.id, current.catalog_hash),
            catalog_for(config.id, saved.catalog_hash), saved.original_name)


class McpTools:
    def __init__(self, catalog, runtime_catalog, manager, store, *, artifacts=None):
        self.catalog = catalog
        self.manager = manager
        self.store = store
        self.artifacts = artifacts
        manager.catalog_for = self._catalog_for
        runtime_catalog.tool_catalog = catalog

    def _catalog_for(self, server_id, catalog_hash):
        with self.store.transaction(write=False) as tx:
            return stored_catalog(tx, server_id, catalog_hash)

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
            raise DomainError("mcp_catalog_invalid", "存储目录与固定摘要不一致")
        if configured_server(tx, config.id) != config or not config.enabled:
            raise DomainError("blocked_incompatible", "配置已改变或停用")
        definitions = {item.name: item for item in snapshot.tools if item.unavailable_reason is None}
        if len(set(selected_names)) != len(selected_names) or set(selected_names) - definitions.keys():
            raise DomainError("mcp_tool_unavailable", "所选工具必须属于当前可用目录")
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
            from flowmate.runtime.recovery import requery_authorization
            from flowmate.runtime.transitions import load
            with self.store.transaction(write=False) as tx:
                activity = load(tx, ActivitySnapshot, ctx.activity_id)
                requery = activity.intent.origin == "user" and requery_authorization(tx, ctx.run_id, activity.id)
                if requery:
                    identity = tx.execute("SELECT json_extract(document,'$.connection_identity') "
                        "FROM mcp_servers WHERE id=?", (config.id,)).fetchone()[0]
            if requery:
                from flowmate.integrations.configuration import connection_identity
                current = self.manager.current(config.id)
                if identity is None or identity != connection_identity(current):
                    raise DomainError("mcp_connection_trust_changed", "原连接身份已失效，请重新核对连接")
                # 用户显式另发的查询可以恢复连接。重连只发现目录，不发送原调用。
                await self.manager.reconfigure(current)
            result = await self.manager.call(config.id, snapshot.content_hash, definition.name, args, cancel,
                before_send=before_send)
            payload = result.model_dump(mode="json")
            staged, content = [], []
            with self.store.transaction(write=False) as tx:
                activity = load(tx, ActivitySnapshot, ctx.activity_id)
            dependencies = [*activity.intent.dependencies, ScopeDependency(scope_id=ctx.activity_id, epoch=1)]
            for item in result.content:
                if item["type"] == "image":
                    if self.artifacts is None:
                        raise DomainError("artifact_unavailable", "图片产物服务未装配")
                    image = self.artifacts.stage_image(ctx, item["data"], item["media_type"], dependencies)
                    staged.append(image)
                    content.append({key: value for key, value in item.items() if key != "data"}
                        | {"artifact": image.ref.model_dump(mode="json")})
                else:
                    content.append(item)
            if content:
                payload["content"] = content
            return ToolOutcome(result={**payload,
                "destination": binding.destination, "external_cost_status": "unknown"},
                error="mcp_tool_error" if result.is_error else None,
                dependencies=[ScopeDependency(scope_id=config.id, epoch=config.revision)],
                staged_artifacts=staged)

        return BoundTool(spec, handler, None, None, lambda tx, ctx, args: {"tool_send": []},
            input_validator=validate_input, result_validator=validate_result, deferred_dispatch=True,
            resolve_version=lambda version: self._resolve_version(config, snapshot, definition, version))

    def _resolve_version(self, config, current, definition, version):
        revision, separator, catalog_hash = version.partition(":")
        if not separator or revision != str(config.revision):
            raise DomainError("blocked_incompatible", "任务固定的 MCP 配置版本已改变")
        with self.store.transaction(write=False) as tx:
            if configured_server(tx, config.id) != config or not config.enabled:
                raise DomainError("blocked_incompatible", "MCP 配置已改变或停用")
            fixed = stored_catalog(tx, config.id, catalog_hash)
            definition = compatible_tool(config, current, fixed, definition.name)
        # 只返回本次所需绑定；目录中仍只保留当前发布版本。
        return self._bind(config, fixed, definition)
