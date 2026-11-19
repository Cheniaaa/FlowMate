"""MCP 管理路由；与 Skill/执行环境路由分文件装配。"""

from typing import Literal

from fastapi import APIRouter

from flowmate.api.contracts import Command, Page
from flowmate.api.routes import body
from flowmate.contracts.base import CommandMeta, Id
from flowmate.contracts.scopes import ScopeRef
from flowmate.integrations.configuration_contracts import (
    McpConfiguredServer,
    McpImportPreview,
    McpImportRequest,
    McpSave,
    McpSelectTools,
    McpServerView,
    McpToolSelection,
)


def router(configuration, *, publisher=None):
    route = APIRouter(prefix="/v3/capabilities/mcp")

    @route.get("", response_model=Page[McpServerView])
    async def servers(scope_kind: Literal["user_global", "workspace"],
                      workspace_id: Id | None = None, query: str = "",
                      limit: int = 100, cursor: str | None = None):
        return configuration.list(ScopeRef(kind=scope_kind, workspace_id=workspace_id),
                                  query=query, limit=limit, cursor=cursor)

    @route.post("/preview", response_model=McpImportPreview)
    async def preview(request=body(McpImportRequest)):
        return configuration.preview_import(request.sanitized_json, request.scope)

    @route.post("", response_model=McpConfiguredServer)
    async def save(command=body(Command[McpSave])):
        return await configuration.save(command.data.config, command.meta,
                                        confirmed=command.data.confirmed)

    @route.get("/{server_id}", response_model=McpServerView)
    async def server(server_id: Id):
        return configuration.view(server_id)

    @route.post("/{server_id}/discover", response_model=McpServerView)
    async def discover(server_id: Id, meta=body(CommandMeta)):
        return await configuration.discover(server_id, meta, publisher=publisher)

    @route.put("/{server_id}/tools", response_model=McpToolSelection)
    async def select_tools(server_id: Id, command=body(Command[McpSelectTools])):
        return await configuration.select_tools(server_id, command.data, command.meta, publisher=publisher)

    return route
