"""仅消费用户明确指定的连接；不从消息文字推断等待目标。"""

import asyncio
import json

from flowmate.contracts.base import DomainError
from flowmate.integrations.configuration import connection_identity
from flowmate.integrations.configuration_contracts import McpToolSelection
from flowmate.integrations.tools import configured_server
from flowmate.runtime.transitions import admission_generations


def require_service(tx, workspace_id, server_id):
    config = configured_server(tx, server_id)
    if not config.enabled or config.scope.workspace_id not in {None, workspace_id}:
        raise DomainError("mcp_unavailable", "所选服务已停用或不属于当前项目")
    stored = json.loads(tx.execute("SELECT document FROM mcp_servers WHERE id=?", (server_id,)).fetchone()[0])
    if stored["connection_identity"] is None:
        raise DomainError("mcp_connection_trust_required", "请先确认所选服务的连接")
    if stored["selection"] is not None:
        selected = McpToolSelection.model_validate(stored["selection"])
        if selected.config_revision != config.revision or not selected.selected_names:
            raise DomainError("mcp_tools_disabled", "所选服务没有启用可用工具")
    return config, stored["connection_identity"]


def require_ready(tx, catalog, workspace_id, server_id):
    config, _ = require_service(tx, workspace_id, server_id)
    if not any(binding.server_id == server_id and binding.config_revision == config.revision
            for binding in catalog.mcp_tools.values()):
        raise DomainError("mcp_not_ready", "所选服务尚未就绪，本次输入未提交", retryable=True)


async def prepare_for_session(configuration, publisher, session_id, server_id, meta):
    with configuration.store.transaction(write=False) as tx:
        session = tx.execute("SELECT workspace_id,archived FROM sessions WHERE id=? AND kind='interaction'",
            (session_id,)).fetchone()
        if session is None or session["archived"]:
            raise DomainError("session_unavailable", "会话不可用，本次输入未提交")
        workspace_id = session["workspace_id"]
        config, identity = require_service(tx, workspace_id, server_id)
        generations = admission_generations(tx, workspace_id, session_id)
    if config.revision != meta.expected_version or connection_identity(config) != identity:
        raise DomainError("mcp_connection_trust_changed", "所选连接已改变，请重新确认，本次输入未提交")
    try:
        async with asyncio.timeout(configuration.manager.limits.request_timeout_seconds):
            view = await configuration.discover(server_id, meta, publisher=publisher,
                trusted_identity=identity)
    except TimeoutError:
        raise DomainError("mcp_admission_timeout", "等待所选服务超时，本次输入未提交", retryable=True) from None
    with configuration.store.transaction(write=False) as tx:
        current, current_identity = require_service(tx, workspace_id, server_id)
        if (current != config or current_identity != identity
                or connection_identity(current) != identity
                or admission_generations(tx, workspace_id, session_id) != generations):
            raise DomainError("mcp_admission_changed", "等待期间连接或会话已改变，本次输入未提交")
    if view.state != "connected":
        raise DomainError(view.error_code or "mcp_connection_failed", "所选服务连接失败，本次输入未提交")
    return view
