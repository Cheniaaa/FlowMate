"""用户管理脚本许可的独立端点；不提供直接执行或任意代码入口。"""

from typing import Literal

from fastapi import APIRouter, Response

from flowmate.api.contracts import Command
from flowmate.api.routes import body
from flowmate.contracts.base import CommandMeta, DomainError, Id
from flowmate.contracts.scopes import ScopeRef
from flowmate.skills.contracts import ContentHash
from flowmate.skills.execution.contracts import SkillExecutionPermission, SkillScriptSettings


def router(runtime):
    route = APIRouter(prefix="/v4/skills")

    def selected(scope_kind, workspace_id):
        if (scope_kind == "workspace") != (workspace_id is not None):
            raise DomainError("invalid_scope", "项目范围须指定工作区，个人范围不接受工作区")
        return ScopeRef(kind=scope_kind, workspace_id=workspace_id)

    @route.get("/{id}/versions/{content_hash}/script-settings", response_model=SkillScriptSettings)
    async def settings(id: Id, content_hash: ContentHash, response: Response,
            scope_kind: Literal["user_global", "workspace"], workspace_id: Id | None = None):
        execution = runtime.script_execution
        response.headers["Cache-Control"] = "no-store"
        scope = selected(scope_kind, workspace_id)
        with execution.store.transaction(write=False) as tx:
            _, version = execution.skills._version(tx, id, content_hash, scope)
            binding = execution.skills._binding(tx, id, scope)
        permissions = execution.permissions.list(id, content_hash, scope)
        return SkillScriptSettings(skill_id=id, content_hash=content_hash, scope=scope,
            scripts=[file.path for file in version.files if file.path.startswith("scripts/")
                and file.path.endswith((".py", ".js", ".mjs", ".cjs", ".ps1", ".sh"))],
            binding=binding, permissions=permissions)

    @route.put("/execution-permissions", response_model=SkillExecutionPermission)
    async def save(response: Response, command=body(Command[SkillExecutionPermission])):
        response.headers["Cache-Control"] = "no-store"
        return runtime.script_execution.permissions.save(command.data, command.meta)

    @route.post("/execution-permissions/{id}/revoke", response_model=SkillExecutionPermission)
    async def revoke(id: Id, response: Response, meta=body(CommandMeta)):
        response.headers["Cache-Control"] = "no-store"
        return runtime.script_execution.permissions.revoke(id, meta)

    return route
