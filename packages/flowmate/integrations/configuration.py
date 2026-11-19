"""MCP 配置保存独立于连接。"""

import asyncio
import hashlib
import json
import unicodedata

from pydantic import ValidationError

from flowmate.api.contracts import Page
from flowmate.api.queries import watermark
from flowmate.contracts.base import CommandMeta, DomainError, identifier
from flowmate.contracts.scopes import ScopeRef
from flowmate.host.protocol import _unique_object
from flowmate.integrations.configuration_contracts import (
    McpConfiguredServer,
    McpImportPreview,
    McpNotice,
    McpSecretSlot,
    McpSelectTools,
    McpServerView,
    McpToolSelection,
)
from flowmate.integrations.contracts import McpCatalog, McpServerConfig
from flowmate.integrations.public import public_catalog
from flowmate.policy.service import _scope


class _StoredServer(McpConfiguredServer):
    selection: McpToolSelection | None = None


class McpConfiguration:
    def __init__(self, store, *, manager=None, changed=None):
        self.store = store
        self.manager = manager
        self.changed = changed
        self._operations = asyncio.Lock()

    @staticmethod
    def _scope(tx, scope):
        if scope.kind == "session":
            raise DomainError("invalid_scope", "MCP 只支持个人或项目范围")
        _scope(tx, scope)

    @staticmethod
    def _fingerprint(operation, data, meta):
        return hashlib.sha256(json.dumps({
            "operation": operation, "parameters": data, "expected_version": meta.expected_version,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()

    @staticmethod
    def _replay(tx, meta, fingerprint, model):
        previous = tx.previous_command(meta.command_id)
        if previous is None:
            return None
        if previous["request_hash"] != fingerprint:
            raise DomainError("command_conflict", "同一 MCP 命令不能改变参数")
        return model.model_validate_json(previous["response"])

    def _stored(self, tx, server_id):
        row = tx.execute("SELECT document FROM mcp_servers WHERE id=?", (server_id,)).fetchone()
        if row is None:
            raise DomainError("not_found", "MCP 配置不存在")
        config = _StoredServer.model_validate_json(row[0])
        self._scope(tx, config.scope)
        return config

    def _get(self, tx, server_id):
        return McpConfiguredServer.model_validate(self._stored(tx, server_id).model_dump(
            include=McpConfiguredServer.model_fields.keys()))

    def preview_import(self, sanitized_json, scope):
        scope = ScopeRef.model_validate(scope.model_dump())
        configs, slots = [], []
        try:
            if len(sanitized_json.encode("utf-8")) > 262144:
                raise ValueError
            value = json.loads(sanitized_json, object_pairs_hook=_unique_object)
            if not isinstance(value, dict) or set(value) != {"mcpServers"}:
                raise ValueError
            servers = value["mcpServers"]
            if not isinstance(servers, dict) or not 1 <= len(servers) <= 100:
                raise ValueError
            used_slots, names = set(), set()
            for name, entry in servers.items():
                if not isinstance(entry, dict) or set(entry) - {"command", "args", "cwd", "env", "url", "headers"}:
                    raise ValueError
                normalized = unicodedata.normalize("NFKC", name.strip()).casefold()
                if normalized in names:
                    raise ValueError
                names.add(normalized)
                server_id = identifier()
                fields = {key: item for key, item in entry.items() if key not in {"env", "headers"}}
                transport = "http" if "url" in entry else "stdio"
                for key, purpose in [("env", "env"), ("headers", "http_token")]:
                    values = entry.get(key, {})
                    if not isinstance(values, dict):
                        raise ValueError
                    if key == "headers" and set(values) - {"Authorization"}:
                        raise ValueError
                    if values and ((key == "env") != (transport == "stdio")):
                        raise ValueError
                    for env_name, marker in values.items():
                        if (not isinstance(marker, dict) or set(marker) != {"secret_slot"}
                                or not isinstance(marker["secret_slot"], str)
                                or not marker["secret_slot"]
                                or len(marker["secret_slot"]) > 128
                                or marker["secret_slot"] in used_slots):
                            raise ValueError
                        if key == "env" and (not env_name or "=" in env_name or "\x00" in env_name):
                            raise ValueError
                        used_slots.add(marker["secret_slot"])
                        slots.append(McpSecretSlot(server_id=server_id, slot=marker["secret_slot"],
                            purpose=purpose, env_name=env_name if key == "env" else None))
                configs.append(McpConfiguredServer(
                    id=server_id, revision=1, display_name=name, scope=scope,
                    transport=transport, **fields,
                ))
            with self.store.transaction(write=False) as tx:
                self._scope(tx, scope)
            return McpImportPreview(configs=configs, required_secret_slots=slots)
        except (ValueError, TypeError, ValidationError, UnicodeError, RecursionError):
            return McpImportPreview(errors=["mcp_import_invalid"])

    async def save(self, config, meta, *, confirmed):
        config = McpConfiguredServer.model_validate(config.model_dump())
        meta = CommandMeta.model_validate(meta.model_dump())
        if confirmed is not True:
            raise DomainError("mcp_confirmation_required", "请确认此配置后保存")
        fingerprint = self._fingerprint("mcp.save", config.model_dump(mode="json"), meta)
        async with self._operations:
            with self.store.transaction(write=False) as tx:
                self._scope(tx, config.scope)
                previous = self._replay(tx, meta, fingerprint, McpConfiguredServer)
                if previous is not None:
                    return previous
                row = tx.execute("SELECT document FROM mcp_servers WHERE id=?", (config.id,)).fetchone()
                old = _StoredServer.model_validate_json(row[0]) if row else None
                if (meta.expected_version != (old.revision if old else None)
                        or config.revision != (old.revision + 1 if old else 1)):
                    raise DomainError("version_conflict", "MCP 配置已改变，请刷新")
                if old is not None and old.scope != config.scope:
                    raise DomainError("mcp_scope_changed", "修改范围须新建配置")
                refs = {*config.env_refs.values(), *([config.credential_ref] if config.credential_ref else [])}
                if len(refs) != len(config.env_refs) + bool(config.credential_ref):
                    raise DomainError("credential_binding_changed", "每个凭据位置须独立引用")
                for other_row in tx.execute("SELECT document FROM mcp_servers"):
                    other = _StoredServer.model_validate_json(other_row[0])
                    other_refs = {*other.env_refs.values(), *([other.credential_ref] if other.credential_ref else [])}
                    if refs & other_refs:
                        raise DomainError("credential_binding_changed", "新修订须使用新凭据引用")
                    if (other.id != config.id and other.scope == config.scope
                            and unicodedata.normalize("NFKC", other.display_name).casefold()
                            == unicodedata.normalize("NFKC", config.display_name).casefold()):
                        raise DomainError("mcp_name_duplicate", "该范围已有同名 MCP 配置")
            # 保存会先撤下旧连接；仅显式 discover 才建立新连接。
            if self.manager is not None:
                await self.manager.invalidate(config.id)
            with self.store.transaction() as tx:
                self._scope(tx, config.scope)
                row = tx.execute("SELECT config_revision FROM mcp_servers WHERE id=?", (config.id,)).fetchone()
                if (row[0] if row else None) != meta.expected_version:
                    raise DomainError("version_conflict", "MCP 配置已改变，请刷新")
                tx.execute("INSERT INTO mcp_servers VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET "
                    "config_revision=excluded.config_revision,document=excluded.document",
                    (config.id, config.revision, _StoredServer(**config.model_dump(),
                        selection=old.selection if old else None).model_dump_json()))
                tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (
                    meta.command_id, fingerprint, config.model_dump_json(), config.scope.workspace_id, None,
                ))
                if self.changed is not None:
                    self.changed(tx, config)
            return config

    def list(self, scope, *, query="", limit=100, cursor=None):
        if not 1 <= limit <= 100 or len(query) > 256:
            raise DomainError("invalid_page", "MCP 查询超出范围")
        with self.store.transaction(write=False) as tx:
            self._scope(tx, scope)
            rows = tx.execute(
                "SELECT document FROM mcp_servers WHERE id>? "
                "AND json_extract(document,'$.scope.kind')=? "
                "AND json_extract(document,'$.scope.workspace_id') IS ? "
                "AND instr(lower(json_extract(document,'$.display_name')),lower(?))>0 "
                "ORDER BY id LIMIT ?", (cursor or "", scope.kind, scope.workspace_id, query, limit + 1),
            ).fetchall()
            configs = [McpConfiguredServer.model_validate(_StoredServer.model_validate_json(row[0]).model_dump(
                include=McpConfiguredServer.model_fields.keys())) for row in rows[:limit]]
            items = [self._view(tx, config) for config in configs]
            return Page[McpServerView](items=items,
                next_cursor=configs[-1].id if len(rows) > limit else None, watermark=watermark(tx))

    def get(self, server_id):
        with self.store.transaction(write=False) as tx:
            return self._get(tx, server_id)

    def view(self, server_id):
        with self.store.transaction(write=False) as tx:
            return self._view(tx, self._get(tx, server_id))

    def _view(self, tx, config):
        row = tx.execute("SELECT document FROM mcp_catalogs WHERE server_id=? "
            "AND json_extract(document,'$.config_revision')=? ORDER BY rowid DESC LIMIT 1",
            (config.id, config.revision)).fetchone()
        state = (self.manager.status(config.id) if self.manager else "saved") if config.enabled else "stopped"
        return McpServerView(config=config, state=state,
            catalog=public_catalog(McpCatalog.model_validate_json(row[0])) if row and state == "connected" else None,
            selection=self._stored(tx, config.id).selection)

    async def discover(self, server_id, meta, *, publisher=None):
        fingerprint = self._fingerprint("mcp.discover", {"server_id": server_id}, meta)
        async with self._operations:
            with self.store.transaction(write=False) as tx:
                config = self._get(tx, server_id)
                previous = self._replay(tx, meta, fingerprint, McpServerView)
                if previous is not None:
                    return previous
                if config.revision != meta.expected_version:
                    raise DomainError("version_conflict", "连接前须核对当前配置修订")
                if not config.enabled:
                    raise DomainError("mcp_disabled", "MCP 配置已停用")
            if self.manager is None:
                raise DomainError("mcp_unavailable", "MCP transport 尚未装配")
            try:
                await self.manager.reconfigure(config)
                catalog = await self.manager.discover(server_id)
                result = McpServerView(config=config, state="connected", catalog=public_catalog(catalog))
            except DomainError as error:
                result = McpServerView(config=config, state="failed", error_code=error.code)
            with self.store.transaction() as tx:
                current = self._get(tx, server_id)
                if current.revision != config.revision:
                    raise DomainError("version_conflict", "发现期间配置已改变")
                if result.catalog is not None:
                    # 重复发现同一 hash 也推进当前目录的位置，拒绝 A→B→A 后的旧 B 选择。
                    tx.execute("INSERT OR REPLACE INTO mcp_catalogs VALUES (?,?,?)",
                        (server_id, catalog.content_hash, catalog.model_dump_json()))
                result = result.model_copy(update={"selection": self._stored(tx, server_id).selection})
                tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (
                    meta.command_id, fingerprint, result.model_dump_json(), config.scope.workspace_id, None,
                ))
                if self.changed is not None:
                    self.changed(tx, config)
                fixed = result.selection
                if (publisher is not None and result.catalog is not None and fixed is not None
                        and fixed.config_revision == config.revision
                        and fixed.catalog_hash == catalog.content_hash):
                    # 显式发现相同目录后恢复已确认选择；目录变化须由用户重新确认。
                    publisher.publish(McpServerConfig.model_validate(config.model_dump(
                        include=McpServerConfig.model_fields.keys())), catalog, fixed.selected_names, tx=tx)
            return result

    async def select_tools(self, server_id, request, meta, *, publisher):
        request = McpSelectTools.model_validate(request.model_dump())
        meta = CommandMeta.model_validate(meta.model_dump())
        fingerprint = self._fingerprint("mcp.select_tools", {
            "server_id": server_id, **request.model_dump(mode="json"),
        }, meta)
        async with self._operations:
            with self.store.transaction() as tx:
                stored = self._stored(tx, server_id)
                previous = self._replay(tx, meta, fingerprint, McpToolSelection)
                if previous is not None:
                    return previous
                config = self._get(tx, server_id)
                if config.scope != request.scope:
                    raise DomainError("mcp_scope_changed", "工具选择的范围与服务器不符")
                if not config.enabled or config.revision != request.config_revision:
                    raise DomainError("blocked_incompatible", "须使用当前启用配置的固定目录")
                if meta.expected_version != (stored.selection.version if stored.selection else None):
                    raise DomainError("version_conflict", "工具选择已改变，请刷新后明确确认")
                row = tx.execute("SELECT catalog_hash,document FROM mcp_catalogs WHERE server_id=? "
                    "AND json_extract(document,'$.config_revision')=? ORDER BY rowid DESC LIMIT 1",
                    (server_id, config.revision)).fetchone()
                if row is None or row["catalog_hash"] != request.catalog_hash:
                    raise DomainError("blocked_incompatible", "发现目录已改变，请重新确认工具选择")
                catalog = McpCatalog.model_validate_json(row["document"])
                content = json.dumps(catalog.model_dump(mode="json", exclude={"content_hash"}),
                    ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
                if (catalog.server_id != server_id or catalog.config_revision != config.revision
                        or catalog.content_hash != request.catalog_hash
                        or hashlib.sha256(content).hexdigest() != request.catalog_hash):
                    raise DomainError("mcp_catalog_invalid", "存储目录与固定摘要不一致")
                definitions = {tool.name: tool for tool in catalog.tools}
                names = request.selected_names
                if (len(set(names)) != len(names) or any(
                    name not in definitions or definitions[name].unavailable_reason is not None for name in names
                )):
                    raise DomainError("mcp_tool_unavailable", "所选工具必须属于当前可用目录")
                if publisher is None:
                    raise DomainError("mcp_unavailable", "MCP 工具发布器尚未装配")
                result = McpToolSelection(server_id=server_id, version=(
                    stored.selection.version + 1 if stored.selection else 1
                ), **request.model_dump())
                stored = stored.model_copy(update={"selection": result})
                tx.execute("UPDATE mcp_servers SET document=? WHERE id=?", (stored.model_dump_json(), server_id))
                tx.execute("INSERT INTO commands VALUES (?,?,?,?,?)", (
                    meta.command_id, fingerprint, result.model_dump_json(), config.scope.workspace_id, None,
                ))
                # 选择通知不调用配置失效回调，避免撤下刚发布的 namespace。
                from flowmate.contracts.events import NewEvent

                tx.append_event(NewEvent(kind="mcp.changed", workspace_id=config.scope.workspace_id,
                    payload=McpNotice(server_id=server_id, config_revision=config.revision, scope=config.scope)))
                publisher.publish(McpServerConfig.model_validate(config.model_dump(
                    include=McpServerConfig.model_fields.keys())), catalog, names, tx=tx)
            return result
