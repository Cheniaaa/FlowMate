"""运行环境设置只使用显式安全投影，不暴露执行配置或私有绑定。"""

from fastapi import APIRouter, Query, Response

from flowmate.api.contracts import Command, Page
from flowmate.api.queries import _page, watermark
from flowmate.api.routes import body
from flowmate.contracts.base import Id
from flowmate.processes.contracts import (
    EnvironmentKind,
    ExecutionEnvironment,
    ExecutionEnvironmentCommandStatus,
    ExecutionEnvironmentView,
    SaveExecutionEnvironment,
)


def router(runtime):
    route = APIRouter(prefix="/v4/settings/execution-environments")

    @route.get("", response_model=Page[ExecutionEnvironmentView])
    async def listing(response: Response, limit: int = 100, cursor: str | None = None):
        environments = runtime.environments
        response.headers["Cache-Control"] = "no-store"
        with environments.store.transaction(write=False) as tx:
            return _page(tx, ExecutionEnvironmentView, "execution_environments",
                "SELECT id,document FROM execution_environments", [], limit=limit, cursor=cursor,
                decode=lambda row: environments._view(
                    ExecutionEnvironment.model_validate_json(row["document"])))

    @route.put("", response_model=ExecutionEnvironmentView)
    async def save(response: Response, command=body(Command[SaveExecutionEnvironment])):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.save_view(command.data, command.meta)

    @route.post("/discover", response_model=Page[ExecutionEnvironmentView])
    async def discover(response: Response, workspace_id: Id | None = None,
            kind: list[EnvironmentKind] | None = Query(default=None)):
        response.headers["Cache-Control"] = "no-store"
        if workspace_id is not None or kind is not None:
            candidates = await runtime.environments.discover(workspace_id=workspace_id,
                kinds=kind if kind is not None else ["python", "node", "powershell", "bash"])
            with runtime.environments.store.transaction(write=False) as tx:
                return Page(items=candidates, watermark=str(watermark(tx)))
        await runtime.environments.discover()
        return await listing(response)

    @route.get("/commands/{id}", response_model=ExecutionEnvironmentCommandStatus)
    async def status(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.command_status(id)

    @route.get("/{id}", response_model=ExecutionEnvironmentView)
    async def get(id: Id, response: Response):
        response.headers["Cache-Control"] = "no-store"
        return runtime.environments.get_view(id)

    @route.post("/{id}/probe", response_model=ExecutionEnvironmentView)
    async def probe(id: Id, response: Response):
        environments = runtime.environments
        response.headers["Cache-Control"] = "no-store"
        await environments.probe(id)
        return environments.get_view(id)

    return route
