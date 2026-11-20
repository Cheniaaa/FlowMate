"""用户明确指定的公共查询许可；不依据服务注释、名称或供应商推断。"""

import json

from flowmate.contracts.base import DomainError
from flowmate.policy.contracts import DataUseGrant


def check_query_binding(tx, binding, scope):
    from flowmate.integrations.configuration_contracts import McpToolSelection
    from flowmate.integrations.tools import configured_server, mcp_destination

    config = configured_server(tx, binding.server_id)
    row = tx.execute("SELECT document FROM mcp_servers WHERE id=?", (config.id,)).fetchone()
    stored = json.loads(row[0])
    if config.transport == "stdio" and stored.get("connection_identity") is None:
        raise DomainError("mcp_connection_trust_required", "公共查询须先确认可固定身份的本机程序")
    value = stored.get("selection")
    selection = McpToolSelection.model_validate(value) if value is not None else None
    if (not config.enabled or config.scope != scope or binding.config_revision != config.revision
            or binding.destination != mcp_destination(config) or selection is None
            or selection.config_revision != config.revision or selection.catalog_hash != binding.catalog_hash
            or binding.original_name not in selection.selected_names):
        raise DomainError("blocked_incompatible", "公共查询许可须绑定当前明确启用的工具及固定目录")
    row = tx.execute("SELECT catalog_hash FROM mcp_catalogs WHERE server_id=? "
        "AND json_extract(document,'$.config_revision')=? ORDER BY rowid DESC LIMIT 1",
        (config.id, config.revision)).fetchone()
    if row is None or row[0] != binding.catalog_hash:
        raise DomainError("blocked_incompatible", "公共查询目录已改变")


def query_grant(tx, ctx, binding, destination):
    for row in tx.execute("SELECT document FROM grants WHERE status='active' "
            "AND (workspace_id IS NULL OR workspace_id=?) AND json_extract(document,'$.destination')=? "
            "AND EXISTS(SELECT 1 FROM json_each(grants.document,'$.mcp_queries') q "
            "WHERE json_extract(q.value,'$.server_id')=?) ORDER BY id",
            (ctx.workspace_id, destination, binding.server_id)):
        grant = DataUseGrant.model_validate_json(row[0])
        if (binding not in grant.mcp_queries or grant.destination != destination
                or grant.scope.workspace_id not in {None, ctx.workspace_id}):
            continue
        check_query_binding(tx, binding, grant.scope)
        return grant
    return None
